import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { configuracaoBanco } from './index.mjs';

const variaveis = ['NODE_ENV', 'DATABASE_URL', 'PGHOST', 'PGDATABASE', 'PGUSER', 'PGPASSWORD'];
const originais = new Map();

beforeEach(() => {
  for (const variavel of variaveis) {
    originais.set(variavel, process.env[variavel]);
    delete process.env[variavel];
  }
});

afterEach(() => {
  for (const variavel of variaveis) {
    const original = originais.get(variavel);
    if (original === undefined) delete process.env[variavel];
    else process.env[variavel] = original;
  }
  originais.clear();
});

describe('Configuração do banco PostgreSQL', () => {
  it('usa as variáveis padrão do driver em desenvolvimento', () => {
    expect(configuracaoBanco()).toEqual({});
  });

  it('usa DATABASE_URL quando configurado', () => {
    process.env.DATABASE_URL = 'postgresql://gratificai:senha@localhost/gratificai';
    expect(configuracaoBanco()).toEqual({ connectionString: process.env.DATABASE_URL });
  });

  it('exige configuração de conexão explícita em produção', () => {
    process.env.NODE_ENV = 'production';
    expect(() => configuracaoBanco()).toThrow('DATABASE_URL ou PGHOST/PGDATABASE/PGUSER/PGPASSWORD');
    process.env.PGHOST = 'postgres';
    process.env.PGDATABASE = 'gratificai';
    process.env.PGUSER = 'gratificai';
    process.env.PGPASSWORD = 'test-password';
    expect(configuracaoBanco()).toEqual({});
  });
});
