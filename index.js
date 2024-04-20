const express = require('express');
const { createServer } = require('http'); // Change from 'node:http' to 'http'
const { join } = require('path');
const { Server } = require('socket.io');
const sqlite3 = require('sqlite3');
const { open } = require('sqlite');

async function main() {
  const db = await open({
    filename: 'chat.db',
    driver: sqlite3.Database
  });

  //await db.exec(`
   // CREATE TABLE IF NOT EXISTS messages (
    //    id INTEGER PRIMARY KEY AUTOINCREMENT,
    //    client_offset TEXT UNIQUE,
     //   content TEXT
   // );
 // `);

  const app = express();
  const server = createServer(app);
  const io = new Server(server, {
    connectionStateRecovery: {}
  });

  // Map to store client IDs and their corresponding background colors
  const clientColors = new Map();

  app.get('/', (req, res) => {
    res.sendFile(join(__dirname, 'index.html'));
  });

  io.on('connection', async (socket) => {
    // Assign background color based on the order of connection
    let backgroundColor;
    if (clientColors.size === 0) {
      backgroundColor = 'aliceblue ';
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
      let result;
      try {
        result = await db.run('INSERT INTO messages (content) VALUES (?)', msg);
      } catch (e) {
        return;
      }

      const messageClass = 'message'; // Add a class for styling
      const messageWithClass = `<li class="${messageClass}" style="background-color: ${backgroundColor}">${msg}</li>`;

      io.emit('chat message', messageWithClass, result.lastID);
    });

    if (!socket.recovered) {
      try {
        await db.each('SELECT id, content FROM messages WHERE id > ?',
          [socket.handshake.auth.serverOffset || 0],
          (_err, row) => {
            socket.emit('chat message', row.content, row.id);
          }
        )
      } catch (e) {
        // Handle error
      }
    }
  });

  let activeClients = 0;

  io.on('connection', (socket) => {
    activeClients++;

    io.emit('activeClients', activeClients);

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





