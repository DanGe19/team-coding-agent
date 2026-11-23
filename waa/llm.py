from typing import List, Dict, Any, Optional
import os
import time


# USD per 1M tokens (input, output). Used only for an *estimated* cost figure;
# override with "pricing": {"input_per_m": ..., "output_per_m": ...} in config.
DEFAULT_PRICING = {
    "us.anthropic.claude-sonnet-4-6": (3.0, 15.0),
    "us.anthropic.claude-haiku-4-5": (1.0, 5.0),
    "us.anthropic.claude-opus-4-6": (15.0, 75.0),
}


class Usage:
    """Token/latency accounting shared by all LanguageModel implementations."""

    def __init__(self, model_name: str = "", pricing: Optional[Dict[str, float]] = None):
        self.model_name = model_name
        if pricing:
            self.input_per_m = float(pricing.get("input_per_m", 0.0))
            self.output_per_m = float(pricing.get("output_per_m", 0.0))
        else:
            self.input_per_m, self.output_per_m = DEFAULT_PRICING.get(model_name, (0.0, 0.0))
        self.calls = 0
        self.input_tokens = 0
        self.output_tokens = 0
        self.latency_ms = 0.0
        self.last: Dict[str, Any] = {}

    def record(self, input_tokens: int, output_tokens: int, latency_ms: float) -> Dict[str, Any]:
        self.calls += 1
        self.input_tokens += input_tokens
        self.output_tokens += output_tokens
        self.latency_ms += latency_ms
        self.last = {
            "input_tokens": input_tokens,
            "output_tokens": output_tokens,
            "latency_ms": round(latency_ms, 1),
            "cost_usd": round(self.cost(input_tokens, output_tokens), 6),
        }
        return self.last

    def cost(self, input_tokens: Optional[int] = None, output_tokens: Optional[int] = None) -> float:
        i = self.input_tokens if input_tokens is None else input_tokens
        o = self.output_tokens if output_tokens is None else output_tokens
        return i / 1e6 * self.input_per_m + o / 1e6 * self.output_per_m

    def snapshot(self) -> Dict[str, Any]:
        return {
            "model": self.model_name,
            "calls": self.calls,
            "input_tokens": self.input_tokens,
            "output_tokens": self.output_tokens,
            "total_tokens": self.input_tokens + self.output_tokens,
            "latency_ms": round(self.latency_ms, 1),
            "cost_usd": round(self.cost(), 6),
            "cost_is_estimate": True,
        }

    def diff(self, before: Dict[str, Any]) -> Dict[str, Any]:
        """Usage accumulated since an earlier snapshot()."""
        now = self.snapshot()
        out = {"model": now["model"], "cost_is_estimate": True}
        for k in ("calls", "input_tokens", "output_tokens", "total_tokens", "latency_ms", "cost_usd"):
            out[k] = round(now[k] - before.get(k, 0), 6)
        return out


class LanguageModel:
    def __init__(self):
        self.usage = Usage()

    def generate(self, messages: List[Dict[str, Any]]) -> str:
        raise NotImplementedError("Subclasses must implement this method")


class BedrockLanguageModel(LanguageModel):
    def __init__(self, model_name: str = "us.anthropic.claude-sonnet-4-6", api_key: str = None,
                 pricing: Optional[Dict[str, float]] = None):
        super().__init__()
        self.model_name = model_name
        self.temperature = 0.0
        self.max_tokens = 6000
        self.usage = Usage(model_name, pricing)

        self.api_key = api_key or os.getenv("AWS_BEARER_TOKEN_BEDROCK")
        if not self.api_key:
            raise ValueError("AWS_BEARER_TOKEN_BEDROCK environment variable not set")

        try:
            import boto3
            from botocore.config import Config
        except ImportError:
            raise ImportError("boto3 package not installed. Install with: pip install boto3")
        os.environ["AWS_BEARER_TOKEN_BEDROCK"] = self.api_key
        self.client = boto3.client(
            "bedrock-runtime", region_name="us-east-1", config=Config(read_timeout=300)
        )

    def generate(self, messages: List[Dict[str, Any]]) -> str:
        system = []
        bedrock_messages = []
        for msg in messages:
            role = msg.get("role")
            content = msg.get("content")
            if role == "system":
                system.append({"text": content})
                continue
            if role == "tool":
                role = "user"
                content = f"Tool result: {content}"
            if role not in ("user", "assistant"):
                continue
            block = {"text": content}
            if bedrock_messages and bedrock_messages[-1]["role"] == role:
                bedrock_messages[-1]["content"].append(block)
            else:
                bedrock_messages.append({"role": role, "content": [block]})

        # Sonnet requires a user turn after a reasoning-only assistant response.
        if bedrock_messages and bedrock_messages[-1]["role"] == "assistant":
            bedrock_messages.append({"role": "user", "content": [{"text":
                "Continue."
            }]})

        try:
            request = {
                "modelId": self.model_name,
                "messages": bedrock_messages,
                "inferenceConfig": {
                    "temperature": self.temperature,
                    "maxTokens": self.max_tokens,
                },
            }
            if system:
                request["system"] = system
            request["inferenceConfig"]["stopSequences"] = ["</tool_call>"]
            t0 = time.time()
            response = self.client.converse(**request)
            latency_ms = (time.time() - t0) * 1000
            u = response.get("usage", {}) or {}
            self.usage.record(
                int(u.get("inputTokens", 0)),
                int(u.get("outputTokens", 0)),
                float(response.get("metrics", {}).get("latencyMs", latency_ms)),
            )
            text = "".join(
                block["text"] for block in response["output"]["message"]["content"]
                if "text" in block
            )
            # Generation stops at the closing tag (stop sequence), so put it back.
            if response.get("stopReason") == "stop_sequence" and "<tool_call>" in text:
                text += "</tool_call>"
            return text
        except Exception as e:
            raise RuntimeError(f"Bedrock API error: {str(e)}")


class MockLanguageModel(LanguageModel):
    def __init__(self, responses: List[str] = None):
        super().__init__()
        self.responses = responses or [
            '<tool_call>{"tool": "fs.read", "arguments": {"path": "package.json"}}</tool_call>',
            'Let me check the project structure.',
            '<tool_call>{"tool": "tests.run", "arguments": {"type": "all"}}</tool_call>',
            '<terminate>'
        ]
        self.call_count = 0
        self.usage = Usage("mock")

    def generate(self, messages: List[Dict[str, Any]]) -> str:
        response = self.responses[self.call_count % len(self.responses)]
        self.call_count += 1
        # Rough estimate (4 chars per token) so the accounting path is exercised in tests.
        prompt_chars = sum(len(str(m.get("content", ""))) for m in messages)
        self.usage.record(prompt_chars // 4, len(response) // 4, 0.0)
        return response

    def reset(self):
        self.call_count = 0


def create_language_model(config: Dict[str, Any]) -> LanguageModel:
    llm_type = config.get("llm_type", "mock")

    if llm_type == "bedrock":
        model_name = config.get("model", "us.anthropic.claude-sonnet-4-6")
        api_key = config.get("api_key", os.getenv("AWS_BEARER_TOKEN_BEDROCK"))
        return BedrockLanguageModel(model_name=model_name, api_key=api_key, pricing=config.get("pricing"))
    elif llm_type == "mock":
        responses = config.get("mock_responses")
        return MockLanguageModel(responses=responses)
    else:
        raise ValueError(f"Unknown llm_type: {llm_type}. Use 'bedrock' or 'mock'.")
