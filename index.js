const express = require('express');
const { createServer } = require('http');
const { join } = require('path');
const { Server } = require('socket.io');
const { Pool } = require('pg');
const cors = require('cors');
const sharp = require('sharp');
require('dotenv').config(); // Load environment variables


async function main() {
  let activeClients = 0;

  const pool = new Pool({
    user: process.env.DB_USER,
    host: process.env.DB_HOST,
    database: process.env.DB_DATABASE,
    password: process.env.DB_PASSWORD,
    port: process.env.DB_PORT,
    ssl: {
      rejectUnauthorized: false // Added SSL configuration
    }
  });

  const app = express();
  const server = createServer(app);
  const io = new Server(server, {
    connectionStateRecovery: {}
  });

  app.use(cors());
  app.use(express.json()); // To parse JSON bodies


// API route to check the password
app.post('/check-password', (req, res) => {
  const enteredPassword = req.body.password;
  const correctPassword = process.env.PASSWORD; // Retrieve password from environment variable

  if (enteredPassword === correctPassword) {
    res.json({ success: true });
  } else {
    res.json({ success: false });
  }
});
  

  // Map to store client IDs and their corresponding background colors
  const clientColors = new Map();

  app.get('/', (req, res) => {
    res.sendFile(join(__dirname, 'index.html'));
  });

  // Serve images directly
  app.get('/view/:id', async (req, res) => {
    const { id } = req.params;
    try {
      const message = await pool.query('SELECT content, image FROM messages WHERE id = $1', [id]);
      if (message.rows.length === 0) {
        return res.status(404).send('Message not found');
      }
      const { content, image } = message.rows[0];
      if (image) {
        res.setHeader('Content-Type', 'image/jpeg');
        res.send(image);
      } else {
        res.status(404).send('Not an image message');
      }
    } catch (error) {
      console.error('Error retrieving message:', error);
      res.status(500).send('Internal Server Error');
    }
  });

  io.on('connection', async (socket) => {
    // Assign background color based on the order of connection
    let backgroundColor;
    if (clientColors.size === 0) {
      backgroundColor = 'aliceblue';
    } else if (clientColors.size === 1) {
      backgroundColor = 'antiquewhite';
    } else {
      backgroundColor = 'red';
    }

    // Store the client ID and its background color
    clientColors.set(socket.id, backgroundColor);

    // Listen for 'typing' events from the client
    socket.on('typing', (isTyping) => {
      if (isTyping) {
        socket.broadcast.emit('typing', `typing...`);
      } else {
        socket.broadcast.emit('stop typing', `stopped typing.`);
      }
    });

    socket.on('chat message', async (msg) => {
      try {
        const result = await pool.query('INSERT INTO messages (content, client_offset) VALUES ($1, $2) RETURNING id', [msg, socket.handshake.auth.serverOffset || 0]);
        const messageId = result.rows[0].id;
        const messageWithClass = `<li class="message" style="background-color: ${backgroundColor}">${msg}</li>`;
        io.emit('chat message', messageWithClass, messageId);
      } catch (e) {
        console.error('Error inserting message:', e);
      }
    });


    socket.on('image message', async (base64Data) => {
      try {
        // Decode base64 image data
        const buffer = Buffer.from(base64Data, 'base64');
    
        // Compress the image using Sharp
        const compressedImageBuffer = await sharp(buffer)
          .resize({ width: 1000 }) // Adjust the width as needed
          .jpeg({ quality: 100 }) // Adjust quality level as needed
          .toBuffer();
    
        // Insert the compressed image into the database
        const result = await pool.query('INSERT INTO messages (image, client_offset) VALUES ($1, $2) RETURNING id', [compressedImageBuffer, socket.handshake.auth.serverOffset || 0]);
        const messageId = result.rows[0].id;
        const messageWithClass = `<li class="message" style="background-color: ${backgroundColor}">Image: <a href="/view/${messageId}" target="_blank">View Image</a></li>`;
        io.emit('chat message', messageWithClass, messageId);
      } catch (e) {
        console.error('Error inserting image message:', e);
      }
    });


    if (!socket.recovered) {
      try {
        const result = await pool.query('SELECT id, content, image FROM messages WHERE id > $1 ORDER BY id ASC', [socket.handshake.auth.serverOffset || 0]);

        result.rows.forEach(row => {
          if (row.image) {
            const messageWithClass = `<li class="message" style="background-color: ${backgroundColor}">Image: <a href="/view/${row.id}" target="_blank">View Image</a></li>`;
            socket.emit('chat message', messageWithClass, row.id);
          } else {
            const messageWithClass = `<li class="message" style="background-color: ${backgroundColor}">${row.content}</li>`;
            socket.emit('chat message', messageWithClass, row.id);
          }
        });
      } catch (e) {
        console.error('Error retrieving messages:', e);
      }
    }


    // Update active clients count and handle disconnections
    activeClients++;
    io.emit('activeClients', activeClients);

    socket.on('disconnect', () => {
      activeClients--;
      io.emit('activeClients', activeClients);
      clientColors.delete(socket.id);
    });
  });

  app.get('/view/:id', async (req, res) => {
    const { id } = req.params;
    try {
      const message = await pool.query('SELECT content, image FROM messages WHERE id = $1', [id]);
      if (message.rows.length === 0) {
        return res.status(404).send('Message not found');
      }
      const { content, image } = message.rows[0];
      if (image) {
        res.setHeader('Content-Type', 'image/jpeg');
      }
      res.send(content);
    } catch (error) {
      console.error('Error retrieving message:', error);
      res.status(500).send('Internal Server Error');
    }
  });

  const port = process.env.PORT || 3000;
  server.listen(port, () => {
    console.log(`Server is running on port ${port}`);
  });
}

main()
