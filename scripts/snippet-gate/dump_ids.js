// .fig 노드 id/name/type 덤프 — 매니페스트 fig 컬럼·구조 동치 검증용
const rows = [];
function walk(n) {
  rows.push({ id: n.id, name: n.name, type: n.type });
  if ('children' in n) n.children.forEach(walk);
}
figma.currentPage.children.forEach(walk);
console.log(JSON.stringify(rows));
