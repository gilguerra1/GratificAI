import { StatusEnvio } from '../domain';

export function formatBRL(n: number) { return new Intl.NumberFormat('pt-BR', { style:'currency', currency:'BRL' }).format(n); }
export function pctColor(v: number) { return v >= 80 ? '#10b981' : v >= 70 ? '#3b82f6' : v >= 60 ? '#f59e0b' : '#e11d48'; }
export function statusColor(s: StatusEnvio) {
  return {
    Aprovado:'bg-emerald-100 text-emerald-700 border-emerald-200',
    'Em Análise':'bg-blue-100 text-blue-700 border-blue-200',
    Devolvido:'bg-orange-100 text-orange-700 border-orange-200',
    Pendente:'bg-amber-100 text-amber-700 border-amber-200',
  }[s];
}

export function ProgressBar({ value, color='#1e3a8a' }: { value:number; color?:string }) {
  return (
    <div className="w-full h-1.5 bg-slate-200 rounded-full overflow-hidden">
      <div className="h-full rounded-full transition-all duration-500" style={{ width:`${Math.min(value,100)}%`, backgroundColor:color }} />
    </div>
  );
}
