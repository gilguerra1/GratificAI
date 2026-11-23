import { useEffect, useState } from 'react';
import { Usuario, loginApi, logoutApi, obterSessaoApi, verificarSetupApi } from './api';
import { Profile, Screen, PROFILES } from './domain';
import { carregarEstado, limparEstadoLocal, useStore } from './store';
import { Sidebar } from './components/Sidebar';
import { Header } from './components/Header';
import { DashboardScreen } from './screens/Dashboard';
import { IndicadoresScreen } from './screens/Lancamento';
import { MotorScreen } from './screens/Motor';
import { LoginScreen, TrocaSenhaObrigatoria } from './screens/Login';
import { AdministracaoScreen } from './screens/Administracao';

export default function App() {
  const [user, setUser] = useState<Usuario | null>(null);
  const [screen, setScreen] = useState<Screen>('dashboard');
  const [unidadeSel, setUnidadeSel] = useState<number | null>(null);
  const [menuAberto, setMenuAberto] = useState(false);
  const [iniciando, setIniciando] = useState(true);
  const [erroSessao, setErroSessao] = useState('');
  const [erroOperacao, setErroOperacao] = useState('');
  const st = useStore();

  useEffect(() => {
    let ativo = true;
    void obterSessaoApi()
      .then(sessao => { if (ativo && sessao.user) setUser(sessao.user); })
      .catch(async error => {
        if (!ativo) return;
        try {
          const setup = await verificarSetupApi();
          if (setup.setupRequired) setErroSessao('');
          else setErroSessao(error instanceof Error ? error.message : 'Falha ao validar a sessão.');
        } catch {
          setErroSessao('Não foi possível conectar ao backend.');
        }
      })
      .finally(() => { if (ativo) setIniciando(false); });
    return () => { ativo = false; };
  }, []);

  useEffect(() => {
    const encerrarSessao = () => {
      setUser(null);
      setScreen('dashboard');
      limparEstadoLocal();
    };
    window.addEventListener('gratificai:unauthorized', encerrarSessao);
    return () => window.removeEventListener('gratificai:unauthorized', encerrarSessao);
  }, []);

  useEffect(() => {
    if (user && !user.deveTrocarSenha) void carregarEstado().catch(() => undefined);
  }, [user]);

  const perfil: Profile = user?.perfil ?? 'cam';
  const allowed = PROFILES[perfil].screens;
  const onLogin = async (email: string, senha: string) => {
    const sessao = await loginApi(email, senha);
    setUser(sessao.user);
    setScreen('dashboard');
  };
  const sair = async () => {
    try {
      await logoutApi();
      setUser(null);
      setScreen('dashboard');
      limparEstadoLocal();
    } catch (error) {
      setErroOperacao(error instanceof Error ? error.message : 'Não foi possível encerrar a sessão no servidor.');
    }
  };

  if (iniciando) return <div className="flex h-dvh items-center justify-center bg-slate-100 text-sm font-medium text-slate-600">Verificando sessão…</div>;
  if (!user) {
    return (
      <>
        {erroSessao && <div role="alert" className="fixed inset-x-0 top-0 z-10 bg-rose-700 px-4 py-2 text-center text-xs text-white">{erroSessao}</div>}
        <LoginScreen onLogin={onLogin} />
      </>
    );
  }
  if (user.deveTrocarSenha) {
    return <TrocaSenhaObrigatoria onChanged={novoUsuario => setUser(novoUsuario)} />;
  }
  if (st.carregando) return <div className="flex h-dvh items-center justify-center bg-slate-100 text-sm font-medium text-slate-600">Carregando dados autorizados…</div>;
  if (st.erro) {
    return (
      <div className="flex h-dvh items-center justify-center bg-slate-100 p-5">
        <div className="max-w-md rounded-xl border border-rose-200 bg-white p-6 text-center shadow-sm">
          <h1 className="text-sm font-bold text-slate-900">Não foi possível carregar os dados</h1>
          <p className="mt-2 text-xs text-rose-700">{st.erro}</p>
          <button onClick={() => { void carregarEstado().catch(() => undefined); }}
            className="mt-4 rounded-lg bg-[#0f172a] px-4 py-2 text-xs font-semibold text-white hover:bg-[#1e3a8a]">
            Tentar novamente
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-dvh overflow-hidden bg-slate-100">
      <Sidebar
        screen={screen}
        onNav={nextScreen => { setScreen(nextScreen); setMenuAberto(false); }}
        profile={perfil}
        mobileOpen={menuAberto}
        onClose={() => setMenuAberto(false)}
      />
      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
        <Header user={user} onLogout={() => { void sair(); }} onMenu={() => setMenuAberto(true)} menuOpen={menuAberto} />
        {erroOperacao && <p role="alert" className="border-b border-rose-200 bg-rose-50 px-4 py-2 text-xs text-rose-800">{erroOperacao}</p>}
        <main className="min-h-0 flex-1 overflow-y-auto">
          {screen === 'dashboard' && <DashboardScreen user={user} onVer={id => { setUnidadeSel(id); setScreen('indicadores'); }} onAdministracao={() => setScreen('administracao')} />}
          {screen === 'indicadores' && (
            st.unidades.length
              ? <IndicadoresScreen key={`${perfil}-${unidadeSel ?? st.unidades[0].id}`} profile={perfil} unidade={st.unidades.find(unit => unit.id === unidadeSel) ?? st.unidades[0]} onUnidade={setUnidadeSel} />
              : <EmptyState title="Nenhuma unidade autorizada" message="A CAM deve cadastrar unidades e vincular a sua conta à unidade correspondente." />
          )}
          {screen === 'motor' && perfil === 'cam' && <MotorScreen />}
          {screen === 'administracao' && perfil === 'cam' && <AdministracaoScreen />}
          {!allowed.includes(screen) && <EmptyState title="Acesso não disponível" message="Seu perfil não tem permissão para abrir esta área." />}
        </main>
      </div>
    </div>
  );
}

function EmptyState({ title, message }: { title: string; message: string }) {
  return <section className="m-6 rounded-xl border border-slate-200 bg-white p-8 text-center">
    <h1 className="text-sm font-bold text-slate-800">{title}</h1>
    <p className="mt-2 text-xs text-slate-500">{message}</p>
  </section>;
}
