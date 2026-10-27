import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  clearResetFragment,
  parseResetFragment
} from './password-reset-fragment';

const TOKEN = 'Zm9vYmFyYmF6cXV4MTIzNDU2Nzg5MA';

describe('parseResetFragment', () => {
  it('reads a well formed token', () => {
    expect(parseResetFragment(`#token=${TOKEN}`)).toEqual({
      kind: 'token',
      token: TOKEN
    });
  });

  it('accepts base64url characters', () => {
    const token = 'abc_DEF-123456789ABCDEFxyz';
    expect(parseResetFragment(`#token=${token}`)).toEqual({
      kind: 'token',
      token
    });
  });

  it.each(['', '#', '#foo=bar', '#other'])(
    'reports no token for %j',
    (hash) => {
      expect(parseResetFragment(hash)).toEqual({ kind: 'missing' });
    }
  );

  it.each([
    ['empty value', '#token='],
    ['too short', '#token=abc'],
    ['too long', `#token=${'a'.repeat(513)}`],
    ['impossible characters', '#token=aaaaaaaaaaaaaaaa!!!!'],
    ['whitespace', '#token=aaaaaaaa%20aaaaaaaaaaaa'],
    ['repeated', `#token=${TOKEN}&token=${TOKEN}`]
  ])('reports a malformed token: %s', (_name, hash) => {
    expect(parseResetFragment(hash)).toEqual({ kind: 'malformed' });
  });

  it('still finds the token next to unrelated fragment parameters', () => {
    expect(parseResetFragment(`#foo=1&token=${TOKEN}`)).toEqual({
      kind: 'token',
      token: TOKEN
    });
  });
});

describe('clearResetFragment', () => {
  afterEach(() => {
    window.history.replaceState(null, '', '/');
  });

  it('removes the fragment, keeps path and query, and preserves history.state', () => {
    const nextState = { __NA: true, tree: ['a', 'b'] };
    window.history.replaceState(nextState, '', `/reset-password?x=1#token=${TOKEN}`);
    const lengthBefore = window.history.length;

    clearResetFragment();

    expect(window.location.hash).toBe('');
    expect(window.location.pathname).toBe('/reset-password');
    expect(window.location.search).toBe('?x=1');
    expect(window.location.href).not.toContain(TOKEN);
    expect(window.history.state).toEqual(nextState);
    // replaceState: no agrega una entrada al historial.
    expect(window.history.length).toBe(lengthBefore);
  });

  it('passes the existing state to replaceState untouched', () => {
    const replaceState = vi.fn();
    const state = { marker: 1 };

    clearResetFragment({
      history: { state, replaceState },
      location: { hash: '#token=x', pathname: '/reset-password', search: '' }
    });

    expect(replaceState).toHaveBeenCalledOnce();
    expect(replaceState).toHaveBeenCalledWith(state, '', '/reset-password');
  });

  it('does nothing when there is no fragment', () => {
    const replaceState = vi.fn();

    clearResetFragment({
      history: { state: null, replaceState },
      location: { hash: '', pathname: '/reset-password', search: '' }
    });

    expect(replaceState).not.toHaveBeenCalled();
  });
});
