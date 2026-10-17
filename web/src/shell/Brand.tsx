/** Marca del menú: "Jose News AI · Setter IA" (decisión de Jose). El logo real se pondrá cuando lo pase. */
export function Brand() {
  return (
    <div className="flex items-center gap-3">
      <div className="grid h-9 w-9 place-items-center rounded-full border border-ember-500/40 bg-gradient-to-b from-ember-500/25 to-ember-700/10 font-display text-sm font-extrabold text-ember-300">
        J
      </div>
      <div className="leading-tight">
        <p className="font-display text-[15px] font-bold tracking-[-0.01em] text-snow">Jose News AI</p>
        <p className="label !text-[10px] !tracking-[1.6px]">Setter IA</p>
      </div>
    </div>
  );
}
