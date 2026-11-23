import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { newDb } from 'pg-mem';
import { afterEach, describe, expect, it } from 'vitest';
import { abrirBanco } from './database.mjs';
import { migrarSqliteParaPostgres } from './migrate-sqlite.mjs';

let pastaTemporaria;
let db;

function poolPostgresEmMemoria() {
  const memory = newDb();
  const { Pool } = memory.adapters.createPg();
  return new Pool();
}

afterEach(async () => {
  await db?.close();
  db = null;
  if (pastaTemporaria) rmSync(pastaTemporaria, { recursive: true, force: true });
  pastaTemporaria = undefined;
});

function bancoSqliteComDados(caminho) {
  const sqlite = new DatabaseSync(caminho);
  sqlite.exec(`
    CREATE TABLE distritos (id TEXT PRIMARY KEY, nome TEXT NOT NULL);
    INSERT INTO distritos VALUES ('DS I', 'DS I');
    CREATE TABLE unidades (id INTEGER PRIMARY KEY, nome TEXT, tipo TEXT, distrito_id TEXT, criado_em TEXT);
    INSERT INTO unidades VALUES (42, 'Unidade preservada', 'USF', 'DS I', '2024-01-01');
    CREATE TABLE usuarios (
      id TEXT PRIMARY KEY, nome TEXT, email TEXT, senha_hash TEXT, perfil TEXT, distrito_id TEXT,
      unidade_id INTEGER, ativo INTEGER, deve_trocar_senha INTEGER, criado_em TEXT
    );
    INSERT INTO usuarios VALUES ('cam-id', 'CAM', 'cam@example.test', 'hash', 'cam', NULL, NULL, 1, 0, '2024-01-01');
    CREATE TABLE sessoes (token_hash TEXT, usuario_id TEXT, csrf_token TEXT, expira_em INTEGER, criada_em TEXT);
    INSERT INTO sessoes VALUES ('token-hash', 'cam-id', 'csrf-token', 1999999999999, '2024-01-01');
    CREATE TABLE portarias (id TEXT, payload TEXT);
    INSERT INTO portarias VALUES ('cam-test', '{"id":"cam-test","nome":"Portaria teste"}');
    CREATE TABLE configuracao (chave TEXT, valor TEXT);
    INSERT INTO configuracao VALUES ('vigente_id', 'cam-test');
    CREATE TABLE lancamentos (
      unidade_id INTEGER, campos TEXT, justificativas TEXT, enviado INTEGER, status TEXT,
      parecer_cam TEXT, prazo_resposta TEXT, resposta_unidade TEXT, revisado_por TEXT,
      revisado_em TEXT, atualizado_em TEXT
    );
    INSERT INTO lancamentos VALUES (42, '{"4.1.1":{"n":"8","d":"10"}}', '{}', 1, 'devolvido',
      'Ajustar documento', '2024-12-01', 'Correção aplicada no dado', NULL, NULL, '2024-01-02');
    CREATE TABLE historico (id INTEGER, unidade_id INTEGER, sub_id TEXT, valor REAL, submetido_em TEXT, aprovado INTEGER);
    INSERT INTO historico VALUES (7, 42, '4.1.1', 80, '2024-01-02', 0);
    CREATE TABLE auditoria (id INTEGER, usuario_id TEXT, acao TEXT, detalhes TEXT, criado_em TEXT);
    INSERT INTO auditoria VALUES (9, 'cam-id', 'teste', '{}', '2024-01-02');
  `);
  sqlite.close();
}

describe('Conversão de dados para PostgreSQL', () => {
  it('preserva cadastros, submissões, sessões e histórico sem modificar o arquivo SQLite', async () => {
    pastaTemporaria = mkdtempSync(join(tmpdir(), 'gratificai-migration-'));
    const caminho = join(pastaTemporaria, 'origem.sqlite');
    bancoSqliteComDados(caminho);
    db = await abrirBanco({ pool: poolPostgresEmMemoria(), configurarAuditoria: false });

    const contagens = await migrarSqliteParaPostgres(caminho, db, { resetarSequencias: false });
    const lancamento = await db.prepare('SELECT status, resposta_unidade FROM lancamentos WHERE unidade_id = ?').get(42);
    const historico = await db.prepare('SELECT valor, aprovado FROM historico WHERE id = ?').get(7);
    const sessao = await db.prepare('SELECT csrf_token FROM sessoes WHERE token_hash = ?').get('token-hash');
    const portaria = await db.prepare('SELECT valor FROM configuracao WHERE chave = ?').get('vigente_id');
    const sqlite = new DatabaseSync(caminho, { readOnly: true });
    const lancamentosOriginais = sqlite.prepare('SELECT COUNT(*) AS total FROM lancamentos').get().total;
    sqlite.close();

    expect(contagens).toMatchObject({ unidades: 1, usuarios: 1, sessoes: 1, lancamentos: 1, historico: 1, auditoria: 1 });
    expect(lancamento).toEqual({ status: 'devolvido', resposta_unidade: 'Correção aplicada no dado' });
    expect(historico).toEqual({ valor: 80, aprovado: 0 });
    expect(sessao.csrf_token).toBe('csrf-token');
    expect(portaria.valor).toBe('cam-test');
    expect(lancamentosOriginais).toBe(1);
  });

  it('cancela antes da importação quando o destino já possui registros operacionais', async () => {
    pastaTemporaria = mkdtempSync(join(tmpdir(), 'gratificai-migration-'));
    const caminho = join(pastaTemporaria, 'origem.sqlite');
    bancoSqliteComDados(caminho);
    db = await abrirBanco({ pool: poolPostgresEmMemoria(), configurarAuditoria: false });
    await db.prepare(`
      INSERT INTO usuarios (id, nome, email, senha_hash, perfil, criado_em)
      VALUES ('existente', 'CAM', 'existente@example.test', 'hash', 'cam', '2024-01-01')
    `).run();

    await expect(migrarSqliteParaPostgres(caminho, db))
      .rejects.toThrow('O PostgreSQL já contém dados operacionais');
    expect(Number((await db.prepare('SELECT COUNT(*) AS total FROM unidades').get()).total)).toBe(0);
  });
});
