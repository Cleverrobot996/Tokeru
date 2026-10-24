// attempts 污染检查
const JS = "(()=>{const raw=localStorage.getItem('tokero.mock.v1');if(!raw)return 'no-mock';const db=JSON.parse(raw);const a=db.attempts||[];return JSON.stringify({count:a.length,zero:a.filter(x=>(x.answers?Object.keys(x.answers):[]).length===0).map(x=>({id:x.id,mode:x.mode,set:x.set_id,created:x.created_at}))})})()";
export default [
  { route: '/records' }, { wait: 900 },
  { eval: { name: 'attempts', js: JS } },
];
