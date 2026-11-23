import { FormEvent, useEffect, useState } from 'react';
import { ApiError, Usuario, obterSessaoApi, verificarSetupApi } from '../api';
import { trocarSenha } from '../store';

export function LoginScreen({ onLogin }: { onLogin: (email: string, senha: string) => Promise<void> }) {
  const [email, setEmail] = useState('');
  const [senha, setSenha] = useState('');
  const [erro, setErro] = useState('');
  const [setupNecessario, setSetupNecessario] = useState(false);
  const [carregando, setCarregando] = useState(false);

  useEffect(() => {
    void verificarSetupApi().then(resultado => setSetupNecessario(resultado.setupRequired))
      .catch(() => setErro('Não foi possível conectar à API. Verifique se o backend está em execução.'));
  }, []);

  const entrar = async (event: FormEvent) => {
    event.preventDefault();
    setCarregando(true);
    setErro('');
    try {
      await onLogin(email, senha);
    } catch (error) {
      setErro(error instanceof ApiError ? error.message : 'Não foi possível iniciar a sessão.');
    } finally {
      setCarregando(false);
    }
  };

  return (
    <main className="flex min-h-dvh items-center justify-center bg-slate-100 p-5">
      <section className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-7 shadow-lg">
        <div className="mb-6 flex items-center gap-3">
          <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-[#0f172a] text-lg font-bold text-white">S</div>
          <div>
            <p className="text-sm font-bold text-slate-900">SESAU Recife</p>
            <p className="text-xs text-slate-500">Gratificação Variável por Desempenho</p>
          </div>
        </div>
        <h1 className="text-xl font-bold text-slate-900">Acesso institucional</h1>
        <p className="mb-5 mt-1 text-xs text-slate-500">Entre com a conta vinculada ao seu perfil operacional.</p>

        {setupNecessario ? (
          <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-xs leading-relaxed text-amber-900">
            <p className="font-bold">Configuração inicial necessária</p>
            <p className="mt-1">Nenhuma conta foi criada. Provisione a primeira conta CAM usando o comando documentado no README; não há senha padrão nem criação pública de contas.</p>
          </div>
        ) : (
          <form onSubmit={entrar} className="space-y-4">
            <label className="block text-xs font-semibold text-slate-700">
              E-mail institucional
              <input required autoComplete="username" type="email" value={email} onChange={event => setEmail(event.target.value)}
                className="mt-1.5 w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm font-normal focus:outline-none focus:ring-2 focus:ring-blue-400" />
            </label>
            <label className="block text-xs font-semibold text-slate-700">
              Senha
              <input required autoComplete="current-password" type="password" value={senha} onChange={event => setSenha(event.target.value)}
                className="mt-1.5 w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm font-normal focus:outline-none focus:ring-2 focus:ring-blue-400" />
            </label>
            {erro && <p role="alert" className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-800">{erro}</p>}
            <button disabled={carregando} className="w-full rounded-lg bg-[#0f172a] px-4 py-2.5 text-xs font-semibold text-white hover:bg-[#1e3a8a] disabled:opacity-50">
              {carregando ? 'Validando…' : 'Entrar'}
            </button>
          </form>
        )}
        {erro && setupNecessario && <p role="alert" className="mt-3 text-xs text-rose-700">{erro}</p>}
        <p className="mt-6 border-t border-slate-100 pt-4 text-[10px] text-slate-400">Sessão protegida · Acesso auditado · LGPD</p>
      </section>
    </main>
  );
}

export function TrocaSenhaObrigatoria({ onChanged }: { onChanged: (user: Usuario) => void }) {
  const [senhaAtual, setSenhaAtual] = useState('');
  const [novaSenha, setNovaSenha] = useState('');
  const [confirmacao, setConfirmacao] = useState('');
  const [erro, setErro] = useState('');
  const [salvando, setSalvando] = useState(false);

  const salvar = async (event: FormEvent) => {
    event.preventDefault();
    if (novaSenha !== confirmacao) {
      setErro('A confirmação da nova senha não confere.');
      return;
    }
    setSalvando(true);
    setErro('');
    try {
      await trocarSenha(senhaAtual, novaSenha);
      const sessao = await obterSessaoApi();
      if (!sessao.user) throw new ApiError('A sessão expirou. Entre novamente.', 401);
      onChanged(sessao.user);
    } catch (error) {
      setErro(error instanceof Error ? error.message : 'Não foi possível alterar a senha.');
    } finally {
      setSalvando(false);
    }
  };

  return (
    <main className="flex min-h-dvh items-center justify-center bg-slate-100 p-5">
      <form onSubmit={salvar} className="w-full max-w-md space-y-4 rounded-2xl border border-slate-200 bg-white p-7 shadow-lg">
        <div>
          <p className="text-[10px] font-bold uppercase tracking-wider text-amber-700">Primeiro acesso</p>
          <h1 className="mt-1 text-xl font-bold text-slate-900">Crie sua senha pessoal</h1>
          <p className="mt-2 text-xs text-slate-500">A senha inicial não pode ser reutilizada para acessar os dados. Escolha uma senha com pelo menos 12 caracteres, letras maiúsculas/minúsculas e números.</p>
        </div>
        <label className="block text-xs font-semibold text-slate-700">Senha inicial
          <input required autoComplete="current-password" type="password" value={senhaAtual} onChange={event => setSenhaAtual(event.target.value)} className="mt-1.5 w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm" />
        </label>
        <label className="block text-xs font-semibold text-slate-700">Nova senha
          <input required minLength={12} autoComplete="new-password" type="password" value={novaSenha} onChange={event => setNovaSenha(event.target.value)} className="mt-1.5 w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm" />
        </label>
        <label className="block text-xs font-semibold text-slate-700">Confirmar nova senha
          <input required minLength={12} autoComplete="new-password" type="password" value={confirmacao} onChange={event => setConfirmacao(event.target.value)} className="mt-1.5 w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm" />
        </label>
        {erro && <p role="alert" className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-800">{erro}</p>}
        <button disabled={salvando} className="w-full rounded-lg bg-[#0f172a] px-4 py-2.5 text-xs font-semibold text-white disabled:opacity-50">
          {salvando ? 'Atualizando…' : 'Atualizar senha e continuar'}
        </button>
      </form>
    </main>
  );
}
