import { CommaInput, Field, Target } from './fields';
import { RULE_LABEL } from './steps-meta';
import type { ConditionRule, Flow, FlowStep } from './types';

/** Editor de la condición (Fase 7.3b): qué se mira y a dónde va si es "sí" y si es "no". */

type Step = Extract<FlowStep, { type: 'condition' }>;
type Props = { flow: Flow; step: Step; onChange: (flow: Flow) => void; update: (step: FlowStep) => void };

const DAYS = [
  { day: 1, label: 'L' },
  { day: 2, label: 'M' },
  { day: 3, label: 'X' },
  { day: 4, label: 'J' },
  { day: 5, label: 'V' },
  { day: 6, label: 'S' },
  { day: 0, label: 'D' },
];
/** Zonas habituales (se puede escribir otra). La de tu navegador va primero. */
const COMMON_ZONES = ['Europe/Madrid', 'America/New_York', 'America/Chicago', 'America/Los_Angeles', 'America/Mexico_City', 'America/Bogota', 'America/Argentina/Buenos_Aires', 'UTC'];
const browserZone = (): string => Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';

/** Regla nueva con sus valores iniciales al cambiar de tipo. */
function freshRule(kind: ConditionRule['kind']): ConditionRule {
  switch (kind) {
    case 'has_tag':
      return { kind, tag: '' };
    case 'field':
      return { kind, field: '', op: 'equals', value: '' };
    case 'keyword':
      return { kind, keywords: [] };
    case 'verified':
      return { kind };
    case 'followers':
      return { kind, min: 1000 };
    case 'hours':
      return { kind, from: '09:00', to: '18:00', days: [1, 2, 3, 4, 5], timeZone: browserZone() };
    case 'random':
      return { kind, percent: 50 };
  }
}

export function ConditionEditor({ flow, step, onChange, update }: Props) {
  const { rule } = step;
  const setRule = (next: ConditionRule) => update({ ...step, rule: next });
  return (
    <>
      <Field label="¿Qué se mira?">
        <select className="field" value={rule.kind} onChange={(e) => setRule(freshRule(e.target.value as ConditionRule['kind']))}>
          {Object.entries(RULE_LABEL).map(([kind, label]) => (
            <option key={kind} value={kind}>
              {label}
            </option>
          ))}
        </select>
      </Field>
      <RuleFields rule={rule} onRule={setRule} />
      <Target flow={flow} step={step} handle="true" label="Si es que sí, ir a" value={step.ifTrue} onChange={onChange} />
      <Target flow={flow} step={step} handle="false" label="Si es que no, ir a" value={step.ifFalse} onChange={onChange} />
    </>
  );
}

function RuleFields({ rule, onRule }: { rule: ConditionRule; onRule: (rule: ConditionRule) => void }) {
  switch (rule.kind) {
    case 'has_tag':
      return (
        <Field label="Etiqueta" warn={!rule.tag.trim()} hint="Sin distinguir mayúsculas ni tildes.">
          <input className="field" maxLength={40} value={rule.tag} onChange={(e) => onRule({ ...rule, tag: e.target.value })} />
        </Field>
      );
    case 'field':
      return (
        <>
          <Field label="Nombre del dato" warn={!rule.field.trim()} hint="El mismo que usa el paso «Guardar un dato» (p. ej. interes).">
            <input className="field" maxLength={40} value={rule.field} onChange={(e) => onRule({ ...rule, field: e.target.value })} />
          </Field>
          <Field label="Comparación">
            <select className="field" value={rule.op} onChange={(e) => onRule({ ...rule, op: e.target.value as typeof rule.op })}>
              <option value="equals">Es igual a</option>
              <option value="contains">Contiene</option>
              <option value="set">Tiene algún valor</option>
            </select>
          </Field>
          {rule.op !== 'set' && (
            <Field label="Valor">
              <input className="field" maxLength={200} value={rule.value} onChange={(e) => onRule({ ...rule, value: e.target.value })} />
            </Field>
          )}
        </>
      );
    case 'keyword':
      return (
        <Field label="Palabras (separadas por comas)" warn={rule.keywords.length === 0} hint="Se mira su último mensaje, sin distinguir mayúsculas ni tildes.">
          <CommaInput className="field" value={rule.keywords} onChange={(keywords) => onRule({ ...rule, keywords })} />
        </Field>
      );
    case 'verified':
      return <p className="text-xs text-smoke">Lo dice Instagram. Si la persona aún no te ha escrito, Meta no deja verlo y cuenta como «no».</p>;
    case 'followers':
      return (
        <Field label="Mínimo de seguidores" hint="Si la persona aún no te ha escrito, Meta no deja verlo y cuenta como «no».">
          <input type="number" min={0} className="field" value={rule.min} onChange={(e) => onRule({ ...rule, min: Math.max(0, Math.round(Number(e.target.value) || 0)) })} />
        </Field>
      );
    case 'hours':
      return <HoursFields rule={rule} onRule={onRule} />;
    case 'random':
      return (
        <Field label="Porcentaje que va por «sí»" hint={`El ${100 - rule.percent} % restante va por «no». Sirve para probar dos versiones.`}>
          <input type="number" min={1} max={99} className="field" value={rule.percent} onChange={(e) => onRule({ ...rule, percent: Math.min(99, Math.max(1, Math.round(Number(e.target.value) || 50))) })} />
        </Field>
      );
  }
}

function HoursFields({ rule, onRule }: { rule: Extract<ConditionRule, { kind: 'hours' }>; onRule: (rule: ConditionRule) => void }) {
  const toggle = (day: number) => onRule({ ...rule, days: rule.days.includes(day) ? rule.days.filter((d) => d !== day) : [...rule.days, day] });
  const zones = [...new Set([browserZone(), ...COMMON_ZONES])];
  return (
    <>
      <Field label="Días" warn={rule.days.length === 0}>
        <div className="flex flex-wrap gap-1" role="group" aria-label="Días">
          {DAYS.map(({ day, label }) => (
            <button
              key={day}
              type="button"
              aria-pressed={rule.days.includes(day)}
              onClick={() => toggle(day)}
              className={['h-11 w-11 rounded-lg text-[13px] font-semibold', rule.days.includes(day) ? 'bg-ember-500/20 text-ember-300' : 'border border-white/10 text-ash'].join(' ')}
            >
              {label}
            </button>
          ))}
        </div>
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Desde">
          <input type="time" className="field" value={rule.from} onChange={(e) => onRule({ ...rule, from: e.target.value })} />
        </Field>
        <Field label="Hasta">
          <input type="time" className="field" value={rule.to} onChange={(e) => onRule({ ...rule, to: e.target.value })} />
        </Field>
      </div>
      <Field label="Zona horaria" hint="Si «desde» es más tarde que «hasta», cruza la medianoche (p. ej. 22:00 a 06:00).">
        <input className="field" list="zonas-horarias" value={rule.timeZone} onChange={(e) => onRule({ ...rule, timeZone: e.target.value.trim() })} />
        <datalist id="zonas-horarias">
          {zones.map((zone) => (
            <option key={zone} value={zone} />
          ))}
        </datalist>
      </Field>
    </>
  );
}
