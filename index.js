const express = require('express');
const { createServer } = require('node:http');
const { join } = require('node:path');
const { Server } = require('socket.io');
const readline = require('readline');
const sqlite3 = require('sqlite3');
const { open } = require('sqlite');

async function main() {
  // Password prompt function
  function promptPassword() {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout
    });

    return new Promise((resolve, reject) => {
      rl.question('Enter password: ', (password) => {
        rl.close();
        resolve(password);
      });
    });
  }

  // Define your predefined password
  const predefinedPassword = 'ma&mg';

  // Prompt for password
  async function authenticate() {
    const password = await promptPassword();
    if (password !== predefinedPassword) {
      console.log('Incorrect password. Exiting.');
      process.exit(1);
    }
  }

  // Authenticate before starting the app
  await authenticate();

  // open the database file
  const db = await open({
    filename: 'chat.db',
    driver: sqlite3.Database
  });

  // create our 'messages' table (you can ignore the 'client_offset' column for now)
  await db.exec(`
    CREATE TABLE IF NOT EXISTS messages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        client_offset TEXT UNIQUE,
        content TEXT
    );
  `);

  const app = express();
  const server = createServer(app);
  const io = new Server(server, {
    connectionStateRecovery: {}
  });

  app.get('/', (req, res) => {
    res.sendFile(join(__dirname, 'index.html'));
  });

  io.on('connection', async (socket) => {
    socket.on('chat message', async (msg) => {
      let result;
      try {
        result = await db.run('INSERT INTO messages (content) VALUES (?)', msg);
      } catch (e) {
        // TODO handle the failure
        return;
      }
      io.emit('chat message', msg, result.lastID);
    });
  
    if (!socket.recovered) {
      // if the connection state recovery was not successful
      try {
        await db.each('SELECT id, content FROM messages WHERE id > ?',
          [socket.handshake.auth.serverOffset || 0],
          (_err, row) => {
            socket.emit('chat message', row.content, row.id);
          }
        )
      } catch (e) {
        // something went wrong
      }
    }
  });

  const port = process.env.PORT || 3000; // Use the PORT environment variable or default to 3000

  server.listen(port, () => {
    console.log(`Server is running on port ${port}`);
  });
}

main();

