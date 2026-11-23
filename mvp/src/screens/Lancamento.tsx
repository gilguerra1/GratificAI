import { useEffect, useRef, useState } from 'react';
import {
  Campos, PROFILES, Pesos, Profile, Unidade, calcularNotaGratificacao, chaveMatriz, indicadoresDaUnidade, pctDe, progressoDe, tipoParaPerfil,
} from '../domain';
import { analisarLancamento, portariaVigente, salvarLancamento, submeter, useStore } from '../store';
import { ApiError } from '../api';
import { ResultadoAnalise, resultadoImpedeEnvio } from '../ml';
import { ProgressBar, pctColor } from '../components/ui';

export function IndicadoresScreen({ profile, unidade, onUnidade }: { profile: Profile; unidade: Unidade; onUnidade: (id: number) => void }) {
  const st = useStore();
  const portaria = portariaVigente(st);
  const p = PROFILES[profile];
  const visiveis = st.unidades;

  const salvo = st.lancamentos[unidade.id] ?? {};
  const [campos, setCampos] = useState<Campos>(salvo);
  const [justificativas, setJustificativas] = useState<Record<string, string>>(st.justificativas[unidade.id] ?? {});
  const [respostaUnidade, setRespostaUnidade] = useState(unidade.respostaUnidade ?? '');
  const [analise, setAnalise] = useState<ResultadoAnalise | null>(null);
  const [analisando, setAnalisando] = useState(false);
  const [erroAnalise, setErroAnalise] = useState('');
  const [activeInd, setActiveInd] = useState(0);
  const [aviso, setAviso] = useState('');
  const versaoAnalise = useRef(0);

  const indicadores = indicadoresDaUnidade(unidade, portaria.pesos);
  const ativos = indicadores.filter(i => i.ativo);
  const { total: totalSubs, preenchidos: filledSubs, pct: progPct } = progressoDe(indicadores, campos);
  const pronto = totalSubs > 0 && filledSubs === totalSubs;
  const somenteLeitura = profile === 'cam' || ['Em Análise', 'Aprovado'].includes(unidade.status);
  const pesos = portaria.pesos;
  const estimativa = calcularNotaGratificacao(unidade, campos, portaria, profile);
  const fatorDescricao = ['gg', 'sna', 'snb1', 'snb2'].includes(profile)
    ? ` × fator distrital (${portaria.regras.fatorDistrital.toFixed(2)})`
    : unidade.tipo === 'MAC' ? ` × fator MAC (${portaria.regras.fatorMac.toFixed(2)})` : '';

  useEffect(() => {
    const versao = ++versaoAnalise.current;
    setAnalise(null);
    setErroAnalise('');
    setAnalisando(true);
    const timeout = window.setTimeout(() => {
      void analisarLancamento(unidade.id, campos)
        .then(resultado => {
          if (versaoAnalise.current === versao) setAnalise(resultado);
        })
        .catch(error => {
          if (versaoAnalise.current === versao) {
            setErroAnalise(error instanceof Error ? error.message : 'Falha ao validar os valores.');
          }
        })
        .finally(() => {
          if (versaoAnalise.current === versao) setAnalisando(false);
        });
    }, 250);
    return () => window.clearTimeout(timeout);
  }, [unidade.id, campos]);

  const setCampo = (id: string, field: 'n' | 'd', val: string) => {
    setAviso('');
    setCampos(prev => ({ ...prev, [id]: { ...(prev[id] ?? { n: '', d: '' }), [field]: val } }));
  };

  const salvar = async () => {
    try {
      await salvarLancamento(unidade.id, campos, justificativas, respostaUnidade);
      setAviso('Rascunho salvo no backend.');
    } catch (error) {
      setAviso(error instanceof ApiError ? error.message : 'Falha ao salvar o rascunho.');
    }
  };
  const enviar = async () => {
    try {
      await submeter(unidade.id, campos, justificativas, respostaUnidade);
      setAviso('Indicadores submetidos para a CAM.');
    } catch (error) {
      setAviso(error instanceof Error ? error.message : 'Falha ao submeter os indicadores.');
    }
  };
  const resultados = analise?.campos ?? {};
  const temBloqueio = Object.entries(resultados).some(([id, resultado]) =>
    resultadoImpedeEnvio(resultado, justificativas[id] ?? ''),
  );

  const ind = indicadores[Math.min(activeInd, indicadores.length - 1)];
  const mi = indicadores.indexOf(ind);

  return (
    <div className="p-5 space-y-5">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-xl font-bold text-slate-900">Lançamento de Indicadores</h1>
          <p className="text-xs text-slate-500 mt-0.5">Perfil: {p.label} · Ciclo 3º Quad. 2024 · Entrada via Numerador / Denominador</p>
        </div>
        <div className="flex items-center gap-2">
          {unidade.status !== 'Pendente' && (
            <span className="rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1.5 text-[10px] font-semibold text-slate-700">{unidade.status}</span>
          )}
          {!somenteLeitura && <button onClick={salvar} className="px-4 py-2 bg-[#0f172a] text-white text-xs font-semibold rounded-lg hover:bg-[#1e3a8a] transition-colors cursor-pointer">Salvar Rascunho</button>}
        </div>
      </div>

      {unidade.status === 'Devolvido' && unidade.parecerCam && (
        <div role="status" className="rounded-xl border border-orange-200 bg-orange-50 px-4 py-3 text-xs text-orange-950">
          <p className="font-bold">Lançamento devolvido pela CAM</p>
          <p className="mt-1 whitespace-pre-wrap">{unidade.parecerCam}</p>
          {unidade.prazoResposta && <p className="mt-2 font-semibold">Prazo para resposta: {new Date(`${unidade.prazoResposta}T00:00:00`).toLocaleDateString('pt-BR')}</p>}
          {unidade.revisadoPor && <p className="mt-1 text-[10px] text-orange-800">Parecer de {unidade.revisadoPor}{unidade.revisadoEm ? ` · ${new Date(unidade.revisadoEm).toLocaleString('pt-BR')}` : ''}</p>}
        </div>
      )}
      {unidade.status === 'Devolvido' && (
        <label className="block rounded-xl border border-blue-200 bg-blue-50 px-4 py-3 text-xs font-semibold text-blue-950">
          Resposta à CAM sobre as correções (mínimo 20 caracteres)
          <textarea value={respostaUnidade} maxLength={1000} onChange={event => setRespostaUnidade(event.target.value)}
            rows={3} placeholder="Explique o que foi corrigido ou esclareça os pontos indicados no parecer."
            className="mt-1.5 w-full rounded-lg border border-blue-300 bg-white px-3 py-2 font-normal text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-300" />
        </label>
      )}
      {unidade.status === 'Em Análise' && <p className="rounded-lg border border-blue-200 bg-blue-50 px-4 py-2.5 text-xs text-blue-900">Lançamento submetido e aguardando avaliação da CAM.</p>}
      {unidade.status === 'Aprovado' && <p className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-2.5 text-xs text-emerald-900">Lançamento aprovado pela CAM. Os dados estão bloqueados para edição.</p>}
      {profile === 'cam' && unidade.status === 'Pendente' && (
        <p className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-2.5 text-xs text-amber-950">
          Este lançamento ainda não foi enviado pela unidade. A conta vinculada à unidade deve preencher os indicadores e clicar em “Submeter para CAM”; depois disso, ele aparecerá no painel como “Em Análise” com a opção “Revisar”.
        </p>
      )}
      {profile === 'cam' && unidade.status === 'Em Análise' && (
        <p className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-2.5 text-xs text-slate-700">Volte ao painel geral e clique em “Revisar” para aprovar ou devolver este lançamento.</p>
      )}

      <div className="flex items-center gap-3 bg-white border border-slate-200 rounded-xl px-5 py-3 flex-wrap">
        <p className="text-[10px] text-slate-500 font-medium uppercase tracking-wide">Unidade de Saúde</p>
        {visiveis.length > 1 ? (
          <select value={unidade.id} onChange={e => onUnidade(Number(e.target.value))}
            className="text-xs border border-slate-300 rounded-lg px-3 py-1.5 bg-white text-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-400 font-semibold">
            {visiveis.map(u => <option key={u.id} value={u.id}>{u.nome} · {u.tipo} · {u.distrito}</option>)}
          </select>
        ) : (
          <p className="text-xs font-semibold text-slate-800">{unidade.nome} <span className="font-mono text-slate-400">· {unidade.tipo} · {unidade.distrito}</span></p>
        )}
        <span className="text-[10px] text-slate-400 ml-auto">Portaria vigente: {portaria.nome}</span>
      </div>

      <div role="note" className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-2.5 text-[11px] leading-relaxed text-amber-900">
        Informe somente resultados agregados. Não inclua nomes, documentos, prontuários ou outros dados que identifiquem pacientes ou profissionais nas justificativas.
      </div>

      <div className="bg-white rounded-xl border border-slate-200 px-5 py-3">
        <div className="flex items-center justify-between mb-1.5">
          <p className="text-[10px] text-slate-500 font-medium">Progresso de preenchimento</p>
          <span className="text-[10px] font-mono font-bold text-slate-700">{progPct}%</span>
        </div>
        <ProgressBar value={progPct} color={pctColor(progPct)} />
        <p className="text-[9px] text-slate-400 mt-1">{filledSubs} de {totalSubs} subindicadores preenchidos e válidos</p>
      </div>

      <section aria-label="Nota e gratificação estimadas" className="grid gap-3 sm:grid-cols-2">
        <div className="rounded-xl border border-blue-200 bg-blue-50 px-5 py-4">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-blue-700">
            {estimativa.completa ? 'Nota do lançamento' : 'Nota parcial'}
          </p>
          <p className="mt-1 font-mono text-2xl font-black text-blue-950">{estimativa.nota.toFixed(2)}<span className="text-sm font-semibold">/100</span></p>
          <p className="mt-1 text-[10px] text-blue-800">
            {estimativa.completa ? 'Calculada pelos pesos da portaria vigente.' : 'Estimativa provisória; campos em aberto contam como zero.'}
          </p>
        </div>
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-5 py-4">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-emerald-700">Gratificação esperada</p>
          <p className="mt-1 font-mono text-2xl font-black text-emerald-950">
            {estimativa.gratificacaoEsperada.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}
          </p>
          <p className="mt-1 text-[10px] text-emerald-800">
            {estimativa.nota < portaria.regras.corte
              ? `Nota abaixo do corte de ${portaria.regras.corte}; estimativa conforme regra vigente.`
              : `Vref × nota normalizada${fatorDescricao}.`}
          </p>
        </div>
      </section>

      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
        <div className="flex border-b border-slate-100 overflow-x-auto">
          {ativos.map(i => {
            const idx = indicadores.indexOf(i);
            return (
              <button key={i.id} onClick={() => setActiveInd(idx)}
                className={`relative px-4 py-3 text-[10px] font-semibold whitespace-nowrap transition-colors cursor-pointer border-b-2 flex items-center gap-1.5
                  ${mi === idx ? 'border-[#1e3a8a] text-[#1e3a8a] bg-blue-50/40' : 'border-transparent text-slate-500 hover:text-slate-700 hover:bg-slate-50'}`}>
                <span className="font-mono">Ind {i.id}</span>
                <span className="hidden lg:inline">· {i.nome.split('—')[1]?.trim().split('(')[0].trim()}</span>
                <span className="font-mono text-[9px] bg-slate-100 text-slate-500 px-1 rounded">{pesoDe(unidade, pesos, idx)}%</span>
              </button>
            );
          })}
        </div>

        {ind && (
          !ind.ativo ? (
            <div className="p-10 text-center text-xs text-slate-400">Este indicador não se aplica à unidade {unidade.tipo}.</div>
          ) : (
            <div className="p-5">
              <div className="mb-4">
                <p className="text-sm font-bold text-slate-800">{ind.nome}</p>
                <p className="text-[11px] text-slate-400 mt-0.5">{ind.descricao}</p>
              </div>
              <div className="space-y-4">
                {ind.subs.map(sub => {
                  const c = campos[sub.id];
                  const pct = pctDe(c);
                  return (
                    <div key={sub.id} className={`rounded-xl border p-4 transition-all ${sub.lgpd ? 'border-amber-200 bg-amber-50/30' : 'border-slate-200'}`}>
                      <div className="flex items-start justify-between gap-4 mb-3 flex-wrap">
                        <div className="flex-1">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="text-[9px] font-mono bg-slate-100 text-slate-500 px-1.5 py-0.5 rounded">{sub.id}</span>
                            <p className="text-xs font-semibold text-slate-800">{sub.nome}</p>
                            {sub.lgpd && <span className="text-[9px] font-semibold px-2 py-0.5 bg-amber-100 text-amber-700 border border-amber-200 rounded-full">🔒 LGPD</span>}
                          </div>
                          {sub.descricao && <p className="text-[10px] text-slate-400 mt-0.5">{sub.descricao}</p>}
                          <p className="text-[10px] text-slate-400 mt-0.5">Meta: <span className="font-mono font-semibold text-slate-600">{sub.meta}{sub.meta <= 100 ? '%' : ''}</span></p>
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                          <div className="text-center">
                            <p className="text-[9px] text-slate-400 mb-0.5">Numerador (n)</p>
                            <input type="number" min={0} placeholder="0" value={c?.n ?? ''} disabled={somenteLeitura} onChange={e => setCampo(sub.id, 'n', e.target.value)}
                              className="w-24 text-center text-xs font-mono font-semibold px-2 py-2 rounded-lg border border-slate-300 bg-white text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-300 transition-all" />
                          </div>
                          <span className="text-slate-400 text-lg mt-4">/</span>
                          <div className="text-center">
                            <p className="text-[9px] text-slate-400 mb-0.5">Denominador (d)</p>
                            <input type="number" min={0} placeholder="0" value={c?.d ?? ''} disabled={somenteLeitura} onChange={e => setCampo(sub.id, 'd', e.target.value)}
                              className="w-24 text-center text-xs font-mono font-semibold px-2 py-2 rounded-lg border border-slate-300 bg-white text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-300 transition-all" />
                          </div>
                          <div className="text-center">
                            <p className="text-[9px] text-slate-400 mb-0.5">% Obtido</p>
                            <div className={`w-20 text-center text-sm font-mono font-black px-2 py-2 rounded-lg border
                              ${pct === null ? 'border-slate-200 bg-slate-50 text-slate-300' : pct >= sub.meta ? 'border-emerald-200 bg-emerald-50 text-emerald-700' : 'border-amber-200 bg-amber-50 text-amber-700'}`}>
                              {pct !== null ? `${pct.toFixed(1)}%` : '—'}
                            </div>
                          </div>
                        </div>
                      </div>
                      {pct !== null && (
                        <div className="mt-1.5">
                          <ProgressBar value={Math.min(pct, 100)} color={pct >= sub.meta ? '#10b981' : pct >= 70 ? '#f59e0b' : '#e11d48'} />
                        </div>
                      )}
                      {resultados[sub.id] && (
                        <div className={`mt-3 rounded-lg border px-3 py-2 text-[10px] ${resultados[sub.id].severidade === 'invalid' ? 'border-rose-200 bg-rose-50 text-rose-800' : 'border-amber-200 bg-amber-50 text-amber-800'}`}>
                          <p className="font-semibold">
                            {resultados[sub.id].severidade === 'invalid'
                              ? 'Valor inválido'
                              : resultados[sub.id].origem === 'ml'
                                ? `Isolation Forest · índice de anomalia ${Math.round(resultados[sub.id].score * 100)}%`
                                : 'Alerta de regra · requer conferência'}
                          </p>
                          <p className="mt-0.5">{resultados[sub.id].mensagem}</p>
                          {resultados[sub.id].observacoesHistoricas > 0 && (
                            <p className="mt-0.5 text-[9px] opacity-80">Comparado com {resultados[sub.id].observacoesHistoricas} lançamentos anteriores submetidos desta unidade.</p>
                          )}
                          {resultados[sub.id].precisaJustificativa && (
                            <label className="mt-2 block font-semibold">
                              Justificativa técnica obrigatória (mínimo 20 caracteres)
                              <textarea value={justificativas[sub.id] ?? ''} maxLength={1000}
                                disabled={somenteLeitura}
                                onChange={event => setJustificativas(prev => ({ ...prev, [sub.id]: event.target.value }))}
                                rows={2} placeholder="Descreva a origem do dado e o motivo da divergência."
                                className="mt-1 w-full resize-y rounded-md border border-amber-300 bg-white px-2 py-1.5 font-normal text-slate-700 focus:outline-none focus:ring-2 focus:ring-amber-300" />
                            </label>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )
        )}

        <div className="flex items-center justify-between px-5 py-3.5 border-t border-slate-100 bg-slate-50 gap-3 flex-wrap">
          <p className="text-[11px]">
            {somenteLeitura ? <span className="text-slate-600 font-semibold">Visualização somente leitura.</span>
              : aviso ? <span className="text-slate-600 font-semibold">{aviso}</span>
              : erroAnalise ? <span className="text-rose-700 font-semibold">{erroAnalise}</span>
              : analisando ? <span className="text-blue-700 font-semibold">Verificando consistência…</span>
              : temBloqueio ? <span className="text-rose-700 font-semibold">Corrija os valores inválidos e justifique os alertas para submeter.</span>
              : pronto ? <span className="text-emerald-600 font-semibold">✓ Formulário pronto para submissão</span>
              : <span className="text-amber-600 font-semibold">Preencha todos os subindicadores para submeter.</span>}
          </p>
          {!somenteLeitura && <div className="flex items-center gap-2">
            <button onClick={() => { setCampos(salvo); setJustificativas(st.justificativas[unidade.id] ?? {}); setAviso(''); }} className="px-3 py-2 border border-slate-300 text-slate-600 text-[11px] font-medium rounded-lg hover:bg-white cursor-pointer">Cancelar</button>
            <button disabled={!pronto || !analise || analisando || !!erroAnalise || temBloqueio || (unidade.status === 'Devolvido' && respostaUnidade.trim().length < 20)} onClick={() => { void enviar(); }}
              className="px-4 py-2 bg-[#0f172a] text-white text-[11px] font-semibold rounded-lg hover:bg-[#1e3a8a] disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer transition-colors">
              Submeter para CAM
            </button>
          </div>}
        </div>
      </div>
    </div>
  );
}

function pesoDe(u: Unidade, pesos: Pesos, idx: number) {
  return pesos[chaveMatriz(tipoParaPerfil(u.tipo))][idx];
}
