import { provisionarCAMDoAmbiente } from './index.mjs';

try {
  if (!process.env.BOOTSTRAP_CAM_EMAIL || !process.env.BOOTSTRAP_CAM_PASSWORD) {
    throw new Error('Defina BOOTSTRAP_CAM_EMAIL e BOOTSTRAP_CAM_PASSWORD antes de provisionar a conta CAM inicial.');
  }
  await provisionarCAMDoAmbiente();
} catch (error) {
  console.error(error instanceof Error ? error.message : 'Falha ao provisionar a conta CAM.');
  process.exitCode = 1;
}
