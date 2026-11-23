import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Usuario } from '../api';
import { DS_COLORS, DISTRITOS, Profile, PROFILES, Unidade, indicadoresDaUnidade } from '../domain';
import { carregarEstado, revisarLancamento, useStore } from '../store';
import { ProgressBar, pctColor, statusColor } from '../components/ui';

export function DashboardScreen({
  user,
  onVer,
  onAdministracao,
}: {
  user: Usuario;
  onVer: (unidadeId: number) => void;
  onAdministracao: () => void;
}) {
  const st = useStore();
  const profile: Profile = user.perfil;
  const [filterDS, setFilterDS] = useState('Todos');
  const [filterSt, setFilterSt] = useState('Todos');
  const [unidadeEmRevisao, setUnidadeEmRevisao] = useState<Unidade | null>(null);
  const [atualizando, setAtualizando] = useState(false);
  const [erroAtualizacao, setErroAtualizacao] = useState('');
  const atualizacaoEmCurso = useRef(false);
  const atualizarPainel = useCallback(async () => {
    if (atualizacaoEmCurso.current) return;
    atualizacaoEmCurso.current = true;
    setAtualizando(true);
    setErroAtualizacao('');
    try {
      await carregarEstado({ silencioso: true });
    } catch (error) {
      setErroAtualizacao(error instanceof Error ? error.message : 'Falha ao atualizar o painel.');
    } finally {
      atualizacaoEmCurso.current = false;
      setAtualizando(false);
    }
  }, []);

  useEffect(() => {
    if (profile !== 'cam') return;
    const aoFocar = () => { void atualizarPainel(); };
    const aoMudarVisibilidade = () => {
      if (document.visibilityState === 'visible') void atualizarPainel();
    };
    const intervalo = window.setInterval(() => {
      if (document.visibilityState === 'visible') void atualizarPainel();
    }, 15000);
    window.addEventListener('focus', aoFocar);
    document.addEventListener('visibilitychange', aoMudarVisibilidade);
    return () => {
      window.clearInterval(intervalo);
      window.removeEventListener('focus', aoFocar);
      document.removeEventListener('visibilitychange', aoMudarVisibilidade);
    };
  }, [profile, atualizarPainel]);

  const unidades = st.unidades;
  const distritos = profile === 'cam'
    ? DISTRITOS
    : st.distritos.filter(distrito => user.distrito === distrito.id || unidades.some(unidade => unidade.distrito === distrito.id));
  const distritosComUnidades = distritos.filter(distrito => unidades.some(unidade => unidade.distrito === distrito.id));
  const mediaPreenchimento = unidades.length
    ? unidades.reduce((total, unidade) => total + unidade.preenchimento, 0) / unidades.length
    : null;
  const enviados = Object.values(st.enviadas).filter(Boolean).length;
  const filtradas = useMemo(() => unidades.filter(unidade =>
    (filterDS === 'Todos' || unidade.distrito === filterDS) &&
    (filterSt === 'Todos' || unidade.status === filterSt),
  ), [unidades, filterDS, filterSt]);

  const resumoDistritos = distritos.map(distrito => {
    const daRegiao = unidades.filter(unidade => unidade.distrito === distrito.id);
    const preenchimento = daRegiao.length
      ? daRegiao.reduce((total, unidade) => total + unidade.preenchimento, 0) / daRegiao.length
      : 0;
    return {
      ...distrito,
      unidades: daRegiao.length,
      enviadas: daRegiao.filter(unidade => st.enviadas[unidade.id]).length,
      preenchimento,
    };
  });

  const cards = [
    { label: 'Unidades cadastradas', value: String(unidades.length), sub: 'Unidades acompanhadas no sistema', icon: '◈', color: 'text-blue-600', bg: 'bg-blue-50' },
    { label: 'Distritos com unidades', value: String(distritosComUnidades.length), sub: `${distritos.length} distritos no escopo`, icon: '◉', color: 'text-violet-600', bg: 'bg-violet-50' },
    { label: 'Lançamentos enviados', value: String(enviados), sub: mediaPreenchimento === null ? 'Sem dados de desempenho' : `Preenchimento médio · ${mediaPreenchimento.toFixed(1)}%`, icon: '◆', color: 'text-emerald-600', bg: 'bg-emerald-50' },
  ];

  return (
    <div className="space-y-6 p-4 sm:p-6 lg:p-8">
      <header>
        <h1 className="text-2xl font-bold text-slate-900">Painel de desempenho</h1>
        <p className="mt-1 text-sm text-slate-500">
          Perfil: {PROFILES[profile].label} · Escopo: {user.distrito ?? user.unidadeNome ?? 'Rede completa'}
        </p>
      </header>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        {cards.map(card => (
          <div key={card.label} className="space-y-3 rounded-xl border border-slate-200 bg-white p-5">
            <div className="flex items-center justify-between">
              <p className="text-xs font-medium uppercase tracking-wide text-slate-500">{card.label}</p>
              <span className={`flex h-8 w-8 items-center justify-center rounded-lg text-base ${card.bg} ${card.color}`}>{card.icon}</span>
            </div>
            <p className="font-mono text-2xl font-bold leading-none text-slate-900">{card.value}</p>
            <p className="text-xs text-slate-500">{card.sub}</p>
          </div>
        ))}
      </div>

      <section className="rounded-xl border border-slate-200 bg-white">
        <div className="border-b border-slate-100 px-5 py-4">
          <h2 className="text-base font-semibold text-slate-800">Resumo territorial</h2>
          <p className="mt-1 text-xs text-slate-500">Acompanhe o envio e o preenchimento médio por distrito.</p>
        </div>
        {resumoDistritos.length ? <div className="divide-y divide-slate-50">
          {resumoDistritos.map(distrito => (
            <div key={distrito.id} className="flex flex-wrap items-center gap-4 px-5 py-4">
              <div className="h-10 w-1.5 shrink-0 rounded-full" style={{ backgroundColor: DS_COLORS[distrito.id] ?? '#64748b' }} />
              <div className="min-w-32 flex-1">
                <p className="text-sm font-semibold text-slate-800">{distrito.nome}</p>
                <p className="mt-0.5 text-xs text-slate-500">{distrito.unidades} unidades · {distrito.enviadas} enviadas</p>
              </div>
              <div className="w-44 space-y-1.5">
                <div className="flex justify-between text-[11px] text-slate-500">
                  <span>Preenchimento médio</span>
                  <span className="font-mono font-semibold text-slate-600">{distrito.unidades ? `${distrito.preenchimento.toFixed(1)}%` : 'Sem dados'}</span>
                </div>
                <ProgressBar value={distrito.preenchimento} color={pctColor(distrito.preenchimento)} />
              </div>
            </div>
          ))}
        </div> : <p className="px-5 py-6 text-xs text-slate-500">Seu perfil ainda não tem distrito ou unidade associados.</p>}
      </section>

      <section className="overflow-hidden rounded-xl border border-slate-200 bg-white">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 px-5 py-4">
          <div>
            <h2 className="text-base font-semibold text-slate-800">Unidades no seu escopo</h2>
            <p className="mt-1 text-xs text-slate-500">Nota e gratificação estimada conforme os indicadores e a portaria vigente.</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {profile === 'cam' && (
              <>
                <span className="text-[10px] text-slate-500">Atualização automática a cada 15 s</span>
                <button onClick={() => { void atualizarPainel(); }} disabled={atualizando}
                  className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50">
                  {atualizando ? 'Atualizando…' : 'Atualizar'}
                </button>
              </>
            )}
            <label className="sr-only" htmlFor="filtro-distrito">Filtrar por distrito</label>
            <select id="filtro-distrito" value={filterDS} onChange={event => setFilterDS(event.target.value)} className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs text-slate-700">
              <option>Todos</option>{distritos.map(distrito => <option key={distrito.id}>{distrito.id}</option>)}
            </select>
            <label className="sr-only" htmlFor="filtro-status">Filtrar por status</label>
            <select id="filtro-status" value={filterSt} onChange={event => setFilterSt(event.target.value)} className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs text-slate-700">
              <option>Todos</option><option>Pendente</option><option>Em Análise</option><option>Devolvido</option><option>Aprovado</option>
            </select>
          </div>
        </div>
        {erroAtualizacao && <p role="alert" className="border-b border-rose-200 bg-rose-50 px-5 py-2 text-xs text-rose-800">{erroAtualizacao}</p>}
        {filtradas.length ? <div className="overflow-x-auto">
          <table className="w-full">
            <thead><tr className="border-b border-slate-100">
              {['Unidade', 'Tipo', 'Distrito', 'Preenchimento', 'Nota', 'Gratificação estimada', 'Status', 'Ações'].map(label => (
                <th key={label} scope="col" className="px-4 py-3 text-left text-[10px] font-semibold uppercase tracking-wider text-slate-500">{label}</th>
              ))}
            </tr></thead>
            <tbody>{filtradas.map((unidade, index) => (
              <tr key={unidade.id} className={`border-b border-slate-50 hover:bg-slate-50 ${index % 2 ? 'bg-slate-50/30' : ''}`}>
                <td className="px-4 py-3 text-sm font-medium text-slate-800">{unidade.nome}</td>
                <td className="px-4 py-3"><span className="rounded bg-slate-100 px-2 py-1 font-mono text-xs font-semibold text-slate-600">{unidade.tipo}</span></td>
                <td className="px-4 py-3"><span className="rounded px-2 py-1 font-mono text-xs font-semibold" style={{ backgroundColor: `${DS_COLORS[unidade.distrito] ?? '#64748b'}18`, color: DS_COLORS[unidade.distrito] ?? '#475569' }}>{unidade.distrito}</span></td>
                <td className="w-44 px-4 py-3"><div className="flex items-center gap-2"><ProgressBar value={unidade.preenchimento} color={pctColor(unidade.preenchimento)} /><span className="w-10 shrink-0 font-mono text-xs text-slate-600">{unidade.preenchimento}%</span></div></td>
                <td className="px-4 py-3">
                  {unidade.nota === null
                    ? <span className="text-xs text-slate-400">—</span>
                    : <span className="font-mono text-xs font-semibold text-slate-700" title={unidade.notaCompleta ? 'Nota calculada com todos os subindicadores' : 'Estimativa parcial; respostas ausentes contam como zero'}>
                      {unidade.nota.toFixed(2)}{unidade.notaCompleta ? '' : ' *'}
                    </span>}
                </td>
                <td className="px-4 py-3 font-mono text-xs font-semibold text-emerald-800">
                  {unidade.gratificacaoEsperada === null
                    ? <span className="text-slate-400">—</span>
                    : unidade.gratificacaoEsperada.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}
                </td>
                <td className="px-4 py-3"><span className={`rounded-full border px-2.5 py-1 text-xs font-medium ${statusColor(unidade.status)}`}>{unidade.status}</span></td>
                <td className="px-4 py-3">
                  {profile === 'cam' && unidade.status === 'Em Análise' ? (
                    <button onClick={() => setUnidadeEmRevisao(unidade)} className="rounded-md bg-blue-100 px-3 py-1.5 text-xs font-semibold text-blue-800 hover:bg-blue-200">Revisar</button>
                  ) : profile === 'cam' && unidade.status === 'Pendente' ? (
                    <span className="rounded-md bg-slate-100 px-2.5 py-1.5 text-xs font-medium text-slate-600">Aguardando envio</span>
                  ) : (
                    <button onClick={() => onVer(unidade.id)} className="rounded-md bg-slate-100 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-200">
                      {unidade.status === 'Devolvido' && profile !== 'cam' ? 'Corrigir' : 'Abrir'}
                    </button>
                  )}
                </td>
              </tr>
            ))}</tbody>
          </table>
        </div> : (
          <div className="px-5 py-8 text-center">
            <p className="text-base font-semibold text-slate-700">Nenhuma unidade cadastrada</p>
            <p className="mx-auto mt-1 max-w-md text-sm text-slate-500">Não há unidades associadas ao seu escopo de acesso.</p>
            {profile === 'cam' && <button onClick={onAdministracao} className="mt-4 rounded-lg bg-[#0f172a] px-4 py-2 text-xs font-semibold text-white">Abrir cadastros da CAM</button>}
          </div>
        )}
        <div className="border-t border-slate-100 px-5 py-3"><p className="text-xs text-slate-500">{filtradas.length} de {unidades.length} unidades exibidas · * Estimativa parcial, com respostas ausentes consideradas como zero</p></div>
      </section>
      {unidadeEmRevisao && <RevisaoModal unidade={unidadeEmRevisao} onFechar={() => setUnidadeEmRevisao(null)} />}
    </div>
  );
}

function RevisaoModal({ unidade, onFechar }: { unidade: Unidade; onFechar: () => void }) {
  const st = useStore();
  const unidadeAtual = st.unidades.find(item => item.id === unidade.id) ?? unidade;
  const [parecer, setParecer] = useState('');
  const [prazoResposta, setPrazoResposta] = useState('');
  const [erro, setErro] = useState('');
  const [processando, setProcessando] = useState(false);
  const portaria = st.portarias.find(item => item.id === st.vigenteId) ?? st.portarias[0];
  const subindicadores = portaria
    ? indicadoresDaUnidade(unidade, portaria.pesos).filter(indicador => indicador.ativo).flatMap(indicador => indicador.subs)
    : [];
  const campos = st.lancamentos[unidade.id] ?? {};
  const justificativas = st.justificativas[unidade.id] ?? {};

  const decidir = async (decisao: 'approve' | 'return') => {
    if (decisao === 'return' && parecer.trim().length < 20) {
      setErro('Escreva um parecer com pelo menos 20 caracteres para devolver.');
      return;
    }
    if (decisao === 'return' && !prazoResposta) {
      setErro('Defina o prazo para a unidade responder.');
      return;
    }
    setProcessando(true);
    setErro('');
    try {
      await revisarLancamento(
        unidade.id,
        decisao,
        decisao === 'return' ? parecer.trim() : undefined,
        decisao === 'return' ? prazoResposta : undefined,
      );
      onFechar();
    } catch (error) {
      setErro(error instanceof Error ? error.message : 'Não foi possível registrar a decisão.');
    } finally {
      setProcessando(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 p-4">
      <section role="dialog" aria-modal="true" aria-labelledby="revisao-titulo" className="flex max-h-[90vh] w-full max-w-5xl flex-col overflow-hidden rounded-xl bg-white shadow-2xl">
        <header className="flex items-start justify-between border-b border-slate-100 px-5 py-4">
          <div>
            <h2 id="revisao-titulo" className="text-sm font-bold text-slate-900">Revisar lançamento</h2>
            <p className="mt-1 text-xs text-slate-500">{unidadeAtual.nome} · {unidadeAtual.tipo} · {unidadeAtual.distrito}</p>
          </div>
          <button onClick={onFechar} disabled={processando} aria-label="Fechar revisão" className="rounded-md px-2 py-1 text-slate-500 hover:bg-slate-100">✕</button>
        </header>

        <div className="overflow-y-auto p-5">
          {unidadeAtual.respostaUnidade && (
            <div className="mb-4 rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-xs text-blue-950">
              <p className="font-semibold">Resposta da unidade à devolução anterior</p>
              <p className="mt-1 whitespace-pre-wrap">{unidadeAtual.respostaUnidade}</p>
            </div>
          )}
          <div className="overflow-x-auto rounded-lg border border-slate-200">
            <table className="w-full min-w-[700px] text-left text-xs">
              <thead className="bg-slate-50 text-[9px] uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-3 py-2">Subindicador</th>
                  <th className="px-3 py-2">Numerador</th>
                  <th className="px-3 py-2">Denominador</th>
                  <th className="px-3 py-2">Justificativa</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {subindicadores.map(sub => (
                  <tr key={sub.id}>
                    <td className="px-3 py-2"><span className="font-mono text-slate-500">{sub.id}</span> · {sub.nome}</td>
                    <td className="px-3 py-2 font-mono">{campos[sub.id]?.n ?? '—'}</td>
                    <td className="px-3 py-2 font-mono">{campos[sub.id]?.d ?? '—'}</td>
                    <td className="max-w-sm whitespace-pre-wrap px-3 py-2 text-slate-600">{justificativas[sub.id] || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <label className="mt-4 block text-xs font-semibold text-slate-700">
            Parecer para devolução
            <textarea value={parecer} maxLength={1000} onChange={event => setParecer(event.target.value)} rows={3}
              placeholder="Explique o que precisa ser corrigido ou justificado (mínimo 20 caracteres)."
              className="mt-1.5 w-full rounded-lg border border-slate-300 px-3 py-2 font-normal focus:outline-none focus:ring-2 focus:ring-blue-300" />
          </label>
          <label className="mt-3 block text-xs font-semibold text-slate-700">
            Prazo para a unidade responder
            <input type="date" min={new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 10)}
              value={prazoResposta} onChange={event => setPrazoResposta(event.target.value)}
              className="mt-1.5 block rounded-lg border border-slate-300 px-3 py-2 font-normal focus:outline-none focus:ring-2 focus:ring-blue-300" />
          </label>
          {erro && <p role="alert" className="mt-3 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-800">{erro}</p>}
        </div>

        <footer className="flex flex-wrap justify-end gap-2 border-t border-slate-100 px-5 py-3">
          <button onClick={onFechar} disabled={processando} className="rounded-lg border border-slate-300 px-3 py-2 text-xs text-slate-600 hover:bg-slate-50">Cancelar</button>
          <button onClick={() => { void decidir('return'); }} disabled={processando || parecer.trim().length < 20 || !prazoResposta}
            className="rounded-lg bg-amber-100 px-3 py-2 text-xs font-semibold text-amber-900 hover:bg-amber-200 disabled:opacity-50">
            {processando ? 'Salvando…' : 'Devolver para ajustes'}
          </button>
          <button onClick={() => { void decidir('approve'); }} disabled={processando}
            className="rounded-lg bg-emerald-700 px-3 py-2 text-xs font-semibold text-white hover:bg-emerald-800 disabled:opacity-50">
            {processando ? 'Salvando…' : 'Aprovar lançamento'}
          </button>
        </footer>
      </section>
    </div>
  );
}
