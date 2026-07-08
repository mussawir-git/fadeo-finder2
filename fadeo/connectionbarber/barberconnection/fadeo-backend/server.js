require('dotenv').config();
const express = require('express');
const cors = require('cors');

const authRoutes = require('./authRoutes');
const shopRoutes = require('./shopRoutes');
const barberRoutes = require('./barberRoutes');
const { notFound, errorHandler } = require('./errorHandler');

const app = express();
const PORT = process.env.PORT || 5000;

app.use(cors()); // fine for local dev where the frontend is opened as a static file / different origin
app.use(express.json());

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', time: new Date().toISOString() });
});

app.use('/api/auth', authRoutes);
app.use('/api', barberRoutes);
app.use('/api/shops', shopRoutes);

app.use(notFound);
app.use(errorHandler);

app.listen(PORT, () => {
  console.log(`Fadeo Finder API running on http://localhost:${PORT}`);
});
