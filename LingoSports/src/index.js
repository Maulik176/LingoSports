import express from 'express';

const app = express();
const PORT = 8000;

app.use(express.json());

app.get('/', (req, res) => {
  res.send('LingoSports server is running.');
});

app.listen(PORT, () => {
  const url = `http://localhost:${PORT}`;
  console.log(`Server running at ${url}`);
});
