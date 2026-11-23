import { useState } from 'react';
import { PROFILES } from '../domain';
import { trocarSenha } from '../store';
import type { Usuario } from '../api';

export function Header({ user, onLogout, onMenu, menuOpen }: { user: Usuario; onLogout: () => void; onMenu: () => void; menuOpen: boolean }) {
  const [senhaAtual, setSenhaAtual] = useState('');
  const [novaSenha, setNovaSenha] = useState('');
  const [mensagem, setMensagem] = useState('');
  const [alterarSenha, setAlterarSenha] = useState(false);
  const profile = user.perfil;
  const p = PROFILES[profile];

  const salvarSenha = async () => {
    try {
      await trocarSenha(senhaAtual, novaSenha);
      setSenhaAtual('');
      setNovaSenha('');
      setMensagem('Senha alterada. As outras sessões foram encerradas.');
    } catch (error) {
      setMensagem(error instanceof Error ? error.message : 'Não foi possível alterar a senha.');
    }
  };

  return (
    <header className="relative z-30 flex min-h-16 shrink-0 items-center justify-between gap-3 border-b border-slate-200 bg-white px-4 sm:px-6">
      <div className="flex items-center gap-2 min-w-0">
        <button type="button" onClick={onMenu} aria-label="Abrir menu" aria-controls="main-navigation" aria-expanded={menuOpen} className="rounded-lg border border-slate-200 px-3 py-2 text-slate-700 hover:bg-slate-50 lg:hidden">
          <svg width="18" height="18" viewBox="0 0 20 20" fill="none" aria-hidden="true"><path d="M3 5h14M3 10h14M3 15h14" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round"/></svg>
        </button>
        <div className="min-w-0">
          <p className="hidden truncate text-xs font-medium text-slate-500 sm:block">Prefeitura do Recife · SESAU</p>
          <p className="truncate text-sm font-semibold text-slate-800">Gratificação por desempenho</p>
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-2 sm:gap-2.5">
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-2 rounded-lg border border-slate-200 px-2.5 py-1.5">
            <div className="flex h-8 w-8 items-center justify-center rounded-md bg-[#0f172a]">
              <span className="text-[10px] font-bold text-white">{p.sigla.slice(0, 3)}</span>
            </div>
            <div className="text-left hidden sm:block">
              <p className="max-w-40 truncate text-xs font-semibold leading-tight text-slate-800">{user.nome}</p>
              <p className="mt-0.5 text-[10px] text-slate-500">{p.sigla} · {user.distrito ?? user.unidadeNome ?? 'Rede'}</p>
            </div>
          </div>
          <button type="button" onClick={() => { setAlterarSenha(!alterarSenha); setMensagem(''); }} aria-expanded={alterarSenha}
            className="rounded-lg border border-slate-200 px-2.5 py-2 text-xs font-medium text-slate-600 hover:bg-slate-50">Senha</button>
          <button type="button" onClick={onLogout} className="rounded-lg border border-slate-200 px-2.5 py-2 text-xs font-medium text-slate-600 hover:bg-slate-50">Sair</button>
        </div>
      </div>
      {alterarSenha && (
        <div className="absolute right-5 top-14 z-50 w-72 rounded-xl border border-slate-200 bg-white p-4 shadow-xl">
          <p className="mb-3 text-xs font-bold text-slate-800">Alterar senha</p>
          <input type="password" autoComplete="current-password" placeholder="Senha atual" value={senhaAtual}
            onChange={event => setSenhaAtual(event.target.value)} className="mb-2 w-full rounded-md border border-slate-300 px-2.5 py-2 text-xs" />
          <input type="password" autoComplete="new-password" placeholder="Nova senha (mín. 12 caracteres)" value={novaSenha}
            onChange={event => setNovaSenha(event.target.value)} className="w-full rounded-md border border-slate-300 px-2.5 py-2 text-xs" />
          {mensagem && <p role="status" className="mt-2 text-[10px] text-slate-600">{mensagem}</p>}
          <button onClick={() => { void salvarSenha(); }} disabled={!senhaAtual || novaSenha.length < 12}
            className="mt-3 w-full rounded-md bg-[#0f172a] px-3 py-2 text-[10px] font-semibold text-white disabled:opacity-50">Salvar nova senha</button>
        </div>
      )}
    </header>
  );
}
