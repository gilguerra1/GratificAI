import { spawn } from 'node:child_process';

const children = [
  spawn(process.execPath, ['server/index.mjs'], { stdio: 'inherit', env: process.env }),
  spawn(process.execPath, ['node_modules/vite/bin/vite.js'], { stdio: 'inherit', env: process.env }),
];
let encerrando = false;

function encerrar(codigo = 0) {
  if (encerrando) return;
  encerrando = true;
  for (const child of children) if (child.exitCode === null) child.kill();
  process.exitCode = codigo;
}

for (const child of children) {
  child.on('error', error => {
    console.error('Não foi possível iniciar um dos serviços:', error);
    encerrar(1);
  });
  child.on('exit', (codigo, sinal) => {
    if (!encerrando) {
      console.error(`Um serviço encerrou (${sinal ?? codigo ?? 'sem código de saída'}).`);
      encerrar(codigo ?? 1);
    }
  });
}

process.on('SIGINT', () => encerrar());
process.on('SIGTERM', () => encerrar());
