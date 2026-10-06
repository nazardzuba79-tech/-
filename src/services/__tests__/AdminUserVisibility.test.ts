import { ADMIN_USER_HIDDEN, ADMIN_USER_UNHIDDEN, hiddenAdminUserMapFromEvents } from '../AdminUserVisibility';
const at = (n:number) => new Date(1_800_000_000_000+n);
test('latest admin visibility event wins',()=>{
 const rows=[
  {id:'4',userId:'u2',action:ADMIN_USER_UNHIDDEN,createdAt:at(4)},
  {id:'3',userId:'u1',action:ADMIN_USER_HIDDEN,createdAt:at(3)},
  {id:'2',userId:'u2',action:ADMIN_USER_HIDDEN,createdAt:at(2)},
  {id:'1',userId:'u1',action:ADMIN_USER_UNHIDDEN,createdAt:at(1)}
 ];
 expect([...hiddenAdminUserMapFromEvents(rows).keys()]).toEqual(['u1']);
});
