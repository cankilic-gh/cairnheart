import {
  ATTACK_LABEL,
  FAMILY_COLOR,
  FAMILY_LABEL,
  GRAFTS,
  SLOT_ATTACK,
  SLOT_LABEL,
  type GraftSlot,
  type Loadout,
} from '../game/grafts';
import type { OfferOption } from '../game/run';
import { RUNES } from '../game/runes';

export const hex = (color: number): string => `#${color.toString(16).padStart(6, '0')}`;

/** Front view of the golem; the hero's left arm is on the viewer's right. */
const SLOT_RECTS: Record<GraftSlot, string> = {
  crown: '<rect x="16" y="0" width="8" height="3"/>',
  back: '<rect x="8" y="7" width="4" height="6"/><rect x="28" y="7" width="4" height="6"/>',
  core: '<rect x="17" y="15" width="6" height="6"/>',
  leftArm: '<rect x="32" y="11" width="6" height="21"/>',
  rightArm: '<rect x="2" y="11" width="6" height="21"/>',
};

const BODY =
  '<rect x="15" y="3" width="10" height="8"/><rect x="10" y="11" width="20" height="18"/>' +
  '<rect x="13" y="29" width="5" height="11"/><rect x="22" y="29" width="5" height="11"/>';

/** Tiny pixel golem with the given slots filled in their family colours; `focus` pulses. */
export const golemSvg = (fills: Partial<Record<GraftSlot, string>>, focus: GraftSlot | null = null): string => {
  const slots = (Object.keys(SLOT_RECTS) as GraftSlot[])
    .map((slot) => {
      const fill = fills[slot];
      const cls = slot === focus ? 'g-slot is-focus' : 'g-slot';
      return `<g class="${cls}" fill="${fill ?? 'none'}" stroke="${fill ? 'none' : 'currentColor'}">${SLOT_RECTS[slot]}</g>`;
    })
    .join('');
  return `<svg class="golem" viewBox="0 0 40 40" aria-hidden="true"><g class="g-body">${BODY}</g>${slots}</svg>`;
};

export const loadoutFills = (loadout: Loadout): Partial<Record<GraftSlot, string>> =>
  Object.fromEntries(Object.entries(loadout).map(([slot, id]) => [slot, hex(FAMILY_COLOR[GRAFTS[id].family])]));

const el = (tag: string, cls: string, text?: string): HTMLElement => {
  const e = document.createElement(tag);
  e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
};

/** One card of a relic offer: a graft (slot, attack it rewires, what it replaces) or a rune. */
export const offerCard = (option: OfferOption, index: number, loadout: Loadout): HTMLButtonElement => {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = `offer-card is-${option.type}`;
  const head = el('div', 'offer-card-head');
  const key = el('kbd', 'key', String(index + 1));
  head.append(key);

  if (option.type === 'graft') {
    const g = GRAFTS[option.id];
    const color = hex(FAMILY_COLOR[g.family]);
    btn.style.setProperty('--family', color);
    const glyph = el('span', 'offer-glyph');
    glyph.innerHTML = golemSvg({ ...loadoutFills(loadout), [g.slot]: color }, g.slot);
    head.append(el('span', 'offer-slot', `${SLOT_LABEL[g.slot]} · ${ATTACK_LABEL[SLOT_ATTACK[g.slot]]}`), glyph);
    btn.append(head, el('span', 'offer-name', g.name), el('span', 'offer-text', g.text));
    const current = loadout[g.slot];
    btn.append(
      el('span', 'offer-foot', current ? `Replaces ${GRAFTS[current].name}` : `${FAMILY_LABEL[g.family]} graft · empty slot`),
    );
  } else {
    const r = RUNES[option.id];
    const glyph = el('span', 'offer-rune-glyph', '◆');
    head.append(el('span', 'offer-slot', `Rune · ${r.changes}`), glyph);
    btn.append(head, el('span', 'offer-name', r.name), el('span', 'offer-text', r.text), el('span', 'offer-foot', 'Rune · stays all run'));
  }
  return btn;
};
