const express = require('express');
const { engine } = require('express-handlebars');
const path = require('path');

const app = express();

// In-memory message store
let messages = [];
let nextId = 1;

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

// Handlebars setup with helpers
app.engine('handlebars', engine({
  defaultLayout: false,
  helpers: {
    formatTime: function (isoString) {
      const date = new Date(isoString);
      const hours = String(date.getHours()).padStart(2, '0');
      const minutes = String(date.getMinutes()).padStart(2, '0');
      return hours + ':' + minutes;
    },
    eq: function (a, b) {
      return a === b;
    }
  }
}));
app.set('view engine', 'handlebars');
app.set('views', path.join(__dirname, 'views'));

// Serve the main page
app.get('/', (req, res) => {
  res.render('index', { messages });
});

// POST /api/message - Post a new message
app.post('/api/message', (req, res) => {
  const { username, text } = req.body;

  if (!username || !text) {
    return res.status(400).json({ error: 'Username and text are required' });
  }

  const message = {
    id: nextId++,
    username: String(username).trim(),
    text: String(text).trim(),
    timestamp: new Date().toISOString()
  };

  messages.push(message);
  return res.status(201).json(message);
});

// GET /api/messages - Get all messages
app.get('/api/messages', (req, res) => {
  res.status(200).json(messages);
});

// DELETE /api/messages - Delete all messages
app.delete('/api/messages', (req, res) => {
  messages = [];
  nextId = 1;
  res.status(200).json({ message: 'All messages deleted' });
});

module.exports = app;

if (require.main === module) {
  app.listen(3000, () => {
    console.log('Chat Room server running on http://localhost:3000');
  });
}
