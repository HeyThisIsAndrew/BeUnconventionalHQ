const currentPath = '/feed';
const linkHref = 'http://localhost:4321/feed';
const linkPath = new URL(linkHref).pathname.replace(/\/$/, '');
const isMatch = linkPath !== '' && (currentPath === linkPath || currentPath.startsWith(linkPath + '/'));
console.log({ currentPath, linkPath, isMatch });
