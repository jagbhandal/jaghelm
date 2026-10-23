/*
 * StateCell: a table row's state (the Infrastructure and Services tables,
 * #299, #313): the lamp and the model's word, the word in the row's own
 * colour when healthy and in its state's word colour otherwise. A lamp drawn
 * as no signal beside another word (a stale status's last known word, #480)
 * is named "No signal" (lampName); beside its own word it is decorative.
 */
import { StatusLamp } from '../status-lamp.jsx';
import { StatusWord } from '../status-word.jsx';
import { WORDS, lampName, toState } from './status.js';

export function StateCell({ state, word }) {
  const s = toState(state);
  const said = word || WORDS[s];
  const named = lampName(s, said);
  return (
    <span className="inline-flex items-center gap-2">
      <StatusLamp state={s} label={named} decorative={named === said} />
      {s === 'ok' ? (
        <span className="font-semibold">{said}</span>
      ) : (
        <StatusWord state={s} word={said} className="font-semibold" />
      )}
    </span>
  );
}
