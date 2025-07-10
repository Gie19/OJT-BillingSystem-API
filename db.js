const mysql = require('mysql');

const connection = mysql.createConnection({
  host: 'localhost',     
  user: 'root',         
  password: '',
  database: 'meterreading',
  port: 3306               
});

connection.connect((err) => {
  if (err) {
    console.error('Connection error:', err.stack);
    return this.resume.status(500).json({ error: err.message });
  }
  console.log('Connected to MySQL as ID', connection.threadId);
});


module.exports = connection;