import { existsSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { abrirBanco } from './database.mjs';
import { configuracaoBanco } from './index.mjs';

function tabelaTemLinhas(sqlite, nome) {
  const existe = sqlite.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(nome);
  return Boolean(existe);
}

function linhas(sqlite, tabela, ordenarPorId = false) {
  if (!tabelaTemLinhas(sqlite, tabela)) return [];
  return sqlite.prepare(`SELECT * FROM ${tabela}${ordenarPorId ? ' ORDER BY id' : ''}`).all();
}

export async function migrarSqliteParaPostgres(caminhoSqlite, db, { resetarSequencias = true } = {}) {
  if (!existsSync(caminhoSqlite)) throw new Error(`Arquivo SQLite não encontrado: ${caminhoSqlite}`);
  const sqlite = new DatabaseSync(caminhoSqlite, { readOnly: true });
  try {
    const origem = {
      distritos: linhas(sqlite, 'distritos'),
      unidades: linhas(sqlite, 'unidades', true),
      usuarios: linhas(sqlite, 'usuarios'),
      sessoes: linhas(sqlite, 'sessoes'),
      portarias: tabelaTemLinhas(sqlite, 'portarias') ? sqlite.prepare('SELECT * FROM portarias ORDER BY rowid').all() : [],
      configuracao: linhas(sqlite, 'configuracao'),
      lancamentos: linhas(sqlite, 'lancamentos'),
      historico: linhas(sqlite, 'historico', true),
      auditoria: linhas(sqlite, 'auditoria', true),
    };
    const existente = await db.prepare(`
      SELECT
        (SELECT COUNT(*) FROM usuarios) +
        (SELECT COUNT(*) FROM unidades) +
        (SELECT COUNT(*) FROM sessoes) +
        (SELECT COUNT(*) FROM lancamentos) +
        (SELECT COUNT(*) FROM historico) +
        (SELECT COUNT(*) FROM auditoria) AS total
    `).get();
    if (Number(existente.total) > 0) {
      throw new Error('O PostgreSQL já contém dados operacionais. A conversão foi cancelada sem alterar a origem.');
    }

    await db.transaction(async () => {
      if (origem.portarias.length) {
        await db.prepare('DELETE FROM configuracao').run();
        await db.prepare('DELETE FROM portarias').run();
      }

      for (const distrito of origem.distritos) {
        await db.prepare(`
          INSERT INTO distritos (id, nome) VALUES (?, ?)
          ON CONFLICT (id) DO UPDATE SET nome = EXCLUDED.nome
        `).run(distrito.id, distrito.nome);
      }
      for (const unidade of origem.unidades) {
        await db.prepare(`
          INSERT INTO unidades (id, nome, tipo, distrito_id, criado_em) VALUES (?, ?, ?, ?, ?)
        `).run(unidade.id, unidade.nome, unidade.tipo, unidade.distrito_id, unidade.criado_em);
      }
      for (const usuario of origem.usuarios) {
        await db.prepare(`
          INSERT INTO usuarios (id, nome, email, senha_hash, perfil, distrito_id, unidade_id, ativo, deve_trocar_senha, criado_em)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
          usuario.id, usuario.nome, String(usuario.email).trim().toLowerCase(), usuario.senha_hash, usuario.perfil,
          usuario.distrito_id ?? null, usuario.unidade_id ?? null, usuario.ativo ?? 1,
          usuario.deve_trocar_senha ?? 0, usuario.criado_em,
        );
      }
      for (const sessao of origem.sessoes) {
        await db.prepare(`
          INSERT INTO sessoes (token_hash, usuario_id, csrf_token, expira_em, criada_em) VALUES (?, ?, ?, ?, ?)
        `).run(sessao.token_hash, sessao.usuario_id, sessao.csrf_token, sessao.expira_em, sessao.criada_em);
      }
      for (const [indice, portaria] of origem.portarias.entries()) {
        await db.prepare('INSERT INTO portarias (id, payload, ordem) VALUES (?, ?, ?)')
          .run(portaria.id, portaria.payload, indice + 1);
      }
      for (const item of origem.configuracao) {
        await db.prepare(`
          INSERT INTO configuracao (chave, valor) VALUES (?, ?)
          ON CONFLICT (chave) DO UPDATE SET valor = EXCLUDED.valor
        `).run(item.chave, item.valor);
      }
      if (origem.portarias.length && !origem.configuracao.some(item => item.chave === 'vigente_id')) {
        await db.prepare('INSERT INTO configuracao (chave, valor) VALUES (?, ?)')
          .run('vigente_id', origem.portarias[0].id);
      }
      for (const lancamento of origem.lancamentos) {
        const status = lancamento.status === 'pendente' && lancamento.enviado
          ? 'em_analise'
          : lancamento.status ?? (lancamento.enviado ? 'em_analise' : 'pendente');
        await db.prepare(`
          INSERT INTO lancamentos (
            unidade_id, campos, justificativas, perfil_lancamento, enviado, status, parecer_cam, prazo_resposta,
            resposta_unidade, revisado_por, revisado_em, atualizado_em
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
          lancamento.unidade_id, lancamento.campos, lancamento.justificativas, lancamento.perfil_lancamento ?? null,
          lancamento.enviado ?? 0, status,
          lancamento.parecer_cam ?? null, lancamento.prazo_resposta ?? null, lancamento.resposta_unidade ?? null,
          lancamento.revisado_por ?? null, lancamento.revisado_em ?? null, lancamento.atualizado_em,
        );
      }
      for (const registro of origem.historico) {
        await db.prepare(`
          INSERT INTO historico (id, unidade_id, sub_id, valor, submetido_em, aprovado)
          VALUES (?, ?, ?, ?, ?, ?)
        `).run(registro.id, registro.unidade_id, registro.sub_id, registro.valor, registro.submetido_em, registro.aprovado ?? 0);
      }
      for (const evento of origem.auditoria) {
        await db.prepare(`
          INSERT INTO auditoria (id, usuario_id, acao, detalhes, criado_em) VALUES (?, ?, ?, ?, ?)
        `).run(evento.id, evento.usuario_id ?? null, evento.acao, evento.detalhes, evento.criado_em);
      }

      if (resetarSequencias) {
        for (const [tabela, coluna] of [['unidades', 'id'], ['historico', 'id'], ['auditoria', 'id'], ['portarias', 'ordem']]) {
          await db.prepare(`
            SELECT setval(pg_get_serial_sequence(?, ?),
              GREATEST(COALESCE((SELECT MAX(${coluna}) FROM ${tabela}), 1), 1),
              EXISTS (SELECT 1 FROM ${tabela}))
          `).get(tabela, coluna);
        }
      }
    });

    return Object.fromEntries(Object.entries(origem).map(([nome, registros]) => [nome, registros.length]));
  } finally {
    sqlite.close();
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const caminho = resolve(process.env.SQLITE_PATH ?? 'data/gratificai.sqlite');
  const db = await abrirBanco(configuracaoBanco());
  try {
    const contagens = await migrarSqliteParaPostgres(caminho, db);
    console.log('Conversão concluída; arquivo SQLite original preservado.');
    for (const [tabela, total] of Object.entries(contagens)) console.log(`${tabela}: ${total}`);
  } catch (error) {
    console.error(error instanceof Error ? error.message : 'Falha ao converter o banco SQLite.');
    process.exitCode = 1;
  } finally {
    await db.close();
  }
}
