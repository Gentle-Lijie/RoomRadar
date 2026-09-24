import express from 'express';

const app = express();
const port = Number(process.env.PORT ?? 3001);
const upstream = 'http://timetablingunnc.nottingham.ac.uk:8017';

app.use(express.json());

app.get('/api/health', (_request, response) => {
  response.json({ ok: true });
});

app.listen(port, () => {
  console.log(`Room Check API listening on http://localhost:${port}`);
});
