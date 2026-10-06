import { ADMIN_USER_HIDDEN, ADMIN_USER_UNHIDDEN, hiddenAdminUserMapFromEvents } from '../AdminUserVisibility';

const at = (n: number) => new Date(1_800_000_000_000 + n);

test('latest visibility event wins and unhide removes the user from hidden set', () => {
  const rows = [
    { id: '4', userId: 'u2', action: ADMIN_USER_UNHIDDEN, createdAt: at(4) },
    { id: '3', userId: 'u1', action: ADMIN_USER_HIDDEN, createdAt: at(3) },
    { id: '2', userId: 'u2', action: ADMIN_USER_HIDDEN, createdAt: at(2) },
    { id: '1', userId: 'u1', action: ADMIN_USER_UNHIDDEN, createdAt: at(1) },
  ];
  const hidden = hiddenAdminUserMapFromEvents(rows);
  expect([...hidden.keys()]).toEqual(['u1']);
  expect(hidden.get('u1')).toEqual(at(3));
});

test('null user rows and older duplicate actions do not override the newest state', () => {
  const rows = [
    { id: '3', userId: null, action: ADMIN_USER_HIDDEN, createdAt: at(3) },
    { id: '2', userId: 'u1', action: ADMIN_USER_HIDDEN, createdAt: at(2) },
    { id: '1', userId: 'u1', action: ADMIN_USER_UNHIDDEN, createdAt: at(1) },
  ];
  expect([...hiddenAdminUserMapFromEvents(rows).entries()]).toEqual([['u1', at(2)]]);
});
