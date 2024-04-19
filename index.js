User
const express = require('express');
const { createServer } = require('http'); // Change from 'node:http' to 'http'
const { join } = require('path');
const { Server } = require('socket.io');
const { Pool } = require('pg'); // Import pg package

async function main() {
  const pool = new Pool({
    user: process.env.DB_USER,
    host: process.env.DB_HOST,
    database: process.env.DB_NAME,
    password: process.env.DB_PASSWORD,
    port: process.env.DB_PORT,
  });

  const app = express();
  const server = createServer(app);
  const io = new Server(server, {
    connectionStateRecovery: {}
  });

  // Map to store client IDs and their corresponding background colors
  const clientColors = new Map();

  app.get('/',(req, res) => { // Apply authentication middleware to the root route
    res.sendFile(join(__dirname, 'index.html'));
  });

  let activeClients = 0; // Define activeClients variable outside of the connection event handler

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
      const clientOffset = socket.handshake.auth.clientOffset || 0;
  
      try {
        // Insert message into PostgreSQL database
        const result = await pool.query('INSERT INTO messages (content, client_offset) VALUES ($1, $2) RETURNING id', [msg, clientOffset]);
        const messageId = result.rows[0].id;
  
        const messageClass = 'message'; // Add a class for styling
        const messageWithClass = `<li class="${messageClass}" style="background-color: ${backgroundColor}">${msg}</li>`;
  
        io.emit('chat message', messageWithClass, result.lastID);
      } catch (e) {
        console.error('Error inserting message:', e);
      }
    });
  
    // Query and emit prior messages when a new connection is established
    try {
      const result = await pool.query('SELECT id, content FROM messages');
      result.rows.forEach(row => {
        socket.emit('chat message', row.content, row.id);
      });
    } catch (e) {
      console.error('Error fetching prior messages:', e);
    }
  
    // Increase active clients count and emit it to all clients
    activeClients++;
    io.emit('activeClients', activeClients);
  
    // Handle client disconnect
    socket.on('disconnect', () => {
      activeClients--;
      io.emit('activeClients', activeClients);
  
      // Remove the disconnected client from the map
      clientColors.delete(socket.id);
    });
  });
  

  const port = process.env.PORT || 3000;
  server.listen(port, () => {
    console.log(`Server is running on port ${port}`);
  });
}

main();





