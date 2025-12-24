const mongoose = require('mongoose');

const connectDB = async () => {
  const mongoUri = process.env.MONGO_URI;

  if (!mongoUri) {
    console.error('\x1b[31m%s\x1b[0m', 'FATAL ERROR: MongoDB URI is missing.');
    console.error('\x1b[33m%s\x1b[0m', 'Please create a .env file in the /server directory with the following content:');
    console.error('MONGO_URI=mongodb+srv://<username>:<password>@cluster.mongodb.net/royale-react?retryWrites=true&w=majority');
    console.error('JWT_SECRET=your_secret_key_here');
    process.exit(1);
  }

  try {
    const conn = await mongoose.connect(mongoUri, {
      useNewUrlParser: true,
      useUnifiedTopology: true,
    });

    console.log(`\x1b[36m%s\x1b[0m`, `MongoDB Connected: ${conn.connection.host}`);
  } catch (error) {
    console.error(`\x1b[31m%s\x1b[0m`, `Error: ${error.message}`);
    process.exit(1);
  }
};

module.exports = connectDB;