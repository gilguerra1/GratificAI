import { useState } from 'react';
import { CARGO_LABELS, MATRIZ_KEYS, Pesos, Portaria, Regras, pesosValidos, regrasValidas, somaPesos } from '../domain';
import { criarPortaria, definirVigente, portariaVigente, publicarPortaria, useStore } from '../store';
import { formatBRL } from '../components/ui';

const MACROS = ['Ind 1\nHórus', 'Ind 2\nGestão', 'Ind 3\nASU', 'Ind 4\nUS', 'Ind 5\nVigilância'];

export function MotorScreen() {
  const st = useStore();
  const vigente = portariaVigente(st);
  const [novaAberta, setNovaAberta] = useState(false);
  const [nomeNova, setNomeNova] = useState('');
  const [aviso, setAviso] = useState('');

  const criar = async () => {
    try {
      await criarPortaria(nomeNova);
      setNovaAberta(false);
      setNomeNova('');
      setAviso('Nova portaria criada e ativada.');
    } catch (error) {
      setAviso(error instanceof Error ? error.message : 'Falha ao criar a portaria.');
    }
  };

  return (
    <div className="p-5 space-y-5">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-xl font-bold text-slate-900">Motor de regras e parametrização</h1>
          <p className="text-xs text-slate-500 mt-0.5">Gestão de versões normativas, prazos e ponderação matricial.</p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <label className="text-[10px] text-slate-500 font-medium">Versão Normativa:</label>
          <select value={vigente.id} onChange={e => { void definirVigente(e.target.value).catch(error => setAviso(error instanceof Error ? error.message : 'Falha ao ativar a portaria.')); }}
            className="text-xs border border-slate-300 rounded-lg px-3 py-1.5 bg-white text-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-400 font-semibold">
            {st.portarias.map(p => <option key={p.id} value={p.id}>{p.nome}</option>)}
          </select>
          <button onClick={() => setNovaAberta(true)} className="text-[11px] px-3 py-1.5 bg-[#0f172a] text-white rounded-lg hover:bg-[#1e3a8a] font-medium cursor-pointer transition-colors">+ Nova Portaria</button>
          <span className="text-[9px] font-semibold px-2 py-1 bg-amber-100 text-amber-700 border border-amber-200 rounded-full">Prazo Hórus: {vigente.regras.prazoHorusDias} dias úteis</span>
        </div>
      </div>

      {aviso && <p role="status" className="rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-[11px] font-medium text-blue-800">{aviso}</p>}
      <Editor key={vigente.id} portaria={vigente} />

      {novaAberta && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4" onClick={() => setNovaAberta(false)}>
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md p-6" onClick={e => e.stopPropagation()}>
            <p className="font-bold text-slate-900 text-sm mb-1">Nova portaria</p>
            <p className="text-[10px] text-slate-500 mb-4">Cria uma nova versão normativa a partir dos pesos e regras da versão vigente. Depois, ajuste e publique.</p>
            <label className="block text-xs font-semibold text-slate-700 mb-1.5">Nome da versão <span className="text-rose-500">*</span></label>
            <input autoFocus value={nomeNova} onChange={e => setNomeNova(e.target.value)} placeholder="Ex.: Portaria Conjunta SESAU/SEPLAGTD nº 05/2025"
              className="w-full border border-slate-300 rounded-xl px-3 py-2.5 text-xs text-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-400" />
            <div className="flex justify-end gap-2 mt-4">
              <button onClick={() => setNovaAberta(false)} className="px-4 py-2 border border-slate-300 text-slate-600 text-xs font-medium rounded-lg hover:bg-slate-50 cursor-pointer">Cancelar</button>
              <button onClick={criar} disabled={!nomeNova.trim()} className="px-4 py-2 bg-[#0f172a] text-white text-xs font-semibold rounded-lg hover:bg-[#1e3a8a] disabled:opacity-40 cursor-pointer">Criar</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function Editor({ portaria }: { portaria: Portaria }) {
  const [tab, setTab] = useState<'matriz' | 'formula'>('matriz');
  const [pesos, setPesos] = useState<Pesos>(() => structuredClone(portaria.pesos));
  const [regras, setRegras] = useState<Regras>({ ...portaria.regras });
  const [editing, setEditing] = useState<{ cargo: keyof Pesos; ind: number } | null>(null);
  const [tempVal, setTempVal] = useState('');
  const [msg, setMsg] = useState('');

  const alterado = JSON.stringify({ pesos, regras }) !== JSON.stringify({ pesos: portaria.pesos, regras: portaria.regras });
  const valido = pesosValidos(pesos) && regrasValidas(regras);

  const publicar = async () => {
    try {
      await publicarPortaria(portaria.id, pesos, regras);
      setMsg('Parametrização publicada no backend.');
    } catch (error) {
      setMsg(error instanceof Error ? error.message : 'Não foi possível publicar a parametrização.');
    }
  };
  const setRegra = (k: keyof Regras, v: string) => { setMsg(''); setRegras(r => ({ ...r, [k]: v === '' ? NaN : Number(v) })); };

  const campos: [keyof Regras, string, string][] = [
    ['vref', 'Valor de referência Vref (R$)', '1'],
    ['corte', 'Nota mínima de corte (NDA)', '1'],
    ['fatorMac', 'FatorCargo · MAC', '0.01'],
    ['fatorDistrital', 'FatorCargo · GG/SnA/SnB', '0.01'],
    ['prazoHorusDias', 'Prazo Hórus (dias úteis)', '1'],
  ];

  const barraPublicar = (
    <div className="flex items-center justify-end gap-3 mt-4 flex-wrap">
      {msg && <span className="text-[11px] font-semibold text-slate-600">{msg}</span>}
      {!valido && <span className="text-[11px] font-semibold text-rose-600">Cada linha deve somar 100% e as regras devem ser válidas.</span>}
      <button disabled={!valido || !alterado} onClick={publicar}
        className="px-5 py-2 bg-[#0f172a] text-white text-[11px] font-semibold rounded-lg hover:bg-[#1e3a8a] disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer transition-colors">
        Publicar Parametrização {portaria.nome.split('—')[0].trim()}
      </button>
    </div>
  );

  return (
    <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
      <div className="flex border-b border-slate-100">
        {([['matriz', '◈ Matriz de Pesos'], ['formula', '⊙ Fórmula Vigente']] as const).map(([id, label]) => (
          <button key={id} onClick={() => setTab(id)}
            className={`px-5 py-3.5 text-[11px] font-semibold transition-colors cursor-pointer border-b-2 whitespace-nowrap
              ${tab === id ? 'border-[#1e3a8a] text-[#1e3a8a] bg-blue-50/40' : 'border-transparent text-slate-500 hover:text-slate-700 hover:bg-slate-50'}`}>
            {label}
          </button>
        ))}
      </div>

      {tab === 'matriz' && (
        <div className="p-5">
          <div className="flex items-start justify-between mb-4 flex-wrap gap-2">
            <div>
              <p className="text-sm font-semibold text-slate-700">Tabela de Ponderação Matricial — 5 Macroindicadores × Cargo</p>
              <p className="text-[10px] text-slate-400 mt-0.5">Clique num valor para editar. A soma de cada linha deve ser 100%.</p>
            </div>
            <span className="text-[9px] text-slate-400 font-mono">{portaria.nome}</span>
          </div>
          <div className="overflow-x-auto rounded-xl border border-slate-200">
            <table className="w-full min-w-[600px]">
              <thead>
                <tr className="bg-slate-900 text-white">
                  <th className="text-left text-[10px] font-semibold px-4 py-3 w-40">Cargo / Tipologia</th>
                  {MACROS.map(m => <th key={m} className="text-center text-[10px] font-semibold px-3 py-3 whitespace-pre-line">{m}</th>)}
                  <th className="text-center text-[10px] font-semibold px-3 py-3">Total</th>
                </tr>
              </thead>
              <tbody>
                {MATRIZ_KEYS.map((cargo, ri) => {
                  const row = pesos[cargo];
                  const total = somaPesos(row);
                  return (
                    <tr key={cargo} className={`border-b border-slate-100 ${ri % 2 === 0 ? '' : 'bg-slate-50/50'}`}>
                      <td className="px-4 py-2.5"><p className="text-[11px] font-semibold text-slate-700">{CARGO_LABELS[cargo]}</p></td>
                      {row.map((peso, ii) => (
                        <td key={ii} className="px-3 py-2.5 text-center">
                          {editing?.cargo === cargo && editing?.ind === ii ? (
                            <div className="flex items-center gap-1 justify-center">
                              <input type="number" value={tempVal} onChange={e => setTempVal(e.target.value)} min={0} max={100} autoFocus
                                className="w-14 text-center text-[11px] font-mono border border-blue-300 rounded px-1 py-0.5 focus:outline-none" />
                              <button onClick={() => {
                                const n = parseInt(tempVal, 10);
                                if (!isNaN(n) && n >= 0 && n <= 100) { setMsg(''); setPesos(prev => ({ ...prev, [cargo]: prev[cargo].map((v, i) => (i === ii ? n : v)) })); }
                                setEditing(null);
                              }} className="text-[9px] px-1.5 py-0.5 bg-emerald-100 text-emerald-700 rounded cursor-pointer">✓</button>
                              <button onClick={() => setEditing(null)} className="text-[9px] px-1.5 py-0.5 bg-slate-100 text-slate-500 rounded cursor-pointer">✕</button>
                            </div>
                          ) : (
                            <button onClick={() => { setEditing({ cargo, ind: ii }); setTempVal(String(peso)); }}
                              className={`text-[11px] font-mono font-bold px-3 py-1.5 rounded-lg transition-colors cursor-pointer
                                ${peso === 0 ? 'text-slate-300 bg-slate-50' : 'text-[#1e3a8a] bg-blue-50 hover:bg-blue-100'}`}>
                              {peso === 0 ? '—' : `${peso}%`}
                            </button>
                          )}
                        </td>
                      ))}
                      <td className="px-3 py-2.5 text-center">
                        <span className={`text-[11px] font-mono font-black px-2 py-1 rounded ${total === 100 ? 'text-emerald-700 bg-emerald-100' : 'text-rose-700 bg-rose-100'}`}>{total}%</span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {barraPublicar}
        </div>
      )}

      {tab === 'formula' && (
        <div className="p-5">
          <div className="grid grid-cols-2 lg:grid-cols-5 gap-3 mb-4">
            {campos.map(([k, label, step]) => (
              <label key={k} className="block">
                <span className="text-[9px] text-slate-400 font-mono uppercase">{label}</span>
                <input type="number" step={step} min={0} value={Number.isNaN(regras[k]) ? '' : regras[k]} onChange={e => setRegra(k, e.target.value)}
                  className="mt-1 w-full text-xs font-mono font-semibold border border-slate-300 rounded-lg px-2.5 py-1.5 focus:outline-none focus:ring-2 focus:ring-blue-300" />
              </label>
            ))}
          </div>
          <div className="bg-[#060f1f] rounded-xl p-5">
            <p className="text-[9px] text-white/30 font-mono uppercase tracking-widest mb-3">Fórmula Vigente · Lei 19.060/2023 · {portaria.nome}</p>
            <pre className="text-emerald-400 text-[11px] font-mono leading-relaxed overflow-x-auto whitespace-pre-wrap">{`GV = Vref × NDA_normalizado × FatorCargo

onde:
  Vref              = ${Number.isNaN(regras.vref) ? '—' : formatBRL(regras.vref)} (valor de referência do cargo)
  NDA_normalizado   = NDA_bruta / 100
  NDA_bruta         = Σ(peso_ind_i × nota_ind_i)   [i = 1..5]

por macroindicador:
  nota_ind_i        = Σ(subind_j_pct × peso_sub_j) / Σ(peso_sub_j)
  subind_j_pct      = (n_j / d_j) × 100            [n=numerador, d=denominador]

regras de corte:
  NDA_bruta < ${regras.corte}    → GV = R$ 0,00   (bloqueio automático — Art. 8º)

Ind 1 prazo Hórus = ${regras.prazoHorusDias} dias úteis
FatorCargo:
  USF / UBT / CAPS / UCIS  → 1.00
  MAC  (Méd/Alta Complex.)  → ${regras.fatorMac.toFixed(2)}
  GG / SnA / SnB            → ${regras.fatorDistrital.toFixed(2)}`}</pre>
          </div>
          {barraPublicar}
        </div>
      )}
    </div>
  );
}
