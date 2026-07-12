const jsdom = require("jsdom");
const { JSDOM } = jsdom;
const dom = new JSDOM(`
  <nav class="nav-container">
    <ul class="nav-list">
      <li class="nav-item"><a href="/feed">Feed</a></li>
      <li class="nav-item"><a href="/events">Events</a></li>
      <li class="nav-item"><a href="/about">About</a></li>
      <li class="nav-item"><a href="/contact">Contact</a></li>
    </ul>
  </nav>
`, { url: 'http://localhost:4321/feed' });

const window = dom.window;
const document = window.document;
const currentPath = '/feed';

const navLinks = document.querySelectorAll('.nav-list .nav-item a');
navLinks.forEach((link) => {
  const linkPath = new URL(link.href).pathname.replace(/\/$/, '');
  const isMatch = linkPath !== '' && (currentPath === linkPath || currentPath.startsWith(linkPath + '/'));
  if (isMatch) {
    link.classList.add('active');
  } else {
    link.classList.remove('active');
  }
});

console.log(document.body.innerHTML);
