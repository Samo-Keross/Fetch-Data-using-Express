import './config/index.js';
import app from './app.js';
import { connectDevice } from './services/sshServices.js';

const port = 7000;

app.listen(port, async () => {
  await connectDevice();
  console.log(`Server running on http://localhost:${port}`);
});