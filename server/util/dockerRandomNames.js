/**
 * Names Docker gives a container started without --name: `<adjective>_<surname>`
 * (e.g. `quirky_sammet`). Such a container is a throwaway `docker run`, never a
 * service, so discovery drops it like the other throwaway containers in
 * helperContainers.js (it would otherwise show as a `container_missing` page).
 *
 * The lists are vendored verbatim from moby's pkg/namesgenerator/names-generator.go
 * at tag v28.5.0 (github.com/moby/moby). Matching is exact on both halves, not a
 * loose `word_word` pattern, because real services can have underscores
 * (`node_exporter`). `boring_wozniak` is the one pair the generator never emits
 * (it re-rolls it), so it is excluded. The retry form with a digit suffix
 * (`quirky_sammet2`, only used on a name collision) is not matched.
 * To refresh: re-copy both lists from a newer moby tag and update the tag above.
 */
export const DOCKER_ADJECTIVES = new Set([
  'admiring', 'adoring', 'affectionate', 'agitated', 'amazing', 'angry', 'awesome', 'beautiful', 'blissful',
  'bold', 'boring', 'brave', 'busy', 'charming', 'clever', 'compassionate', 'competent', 'condescending',
  'confident', 'cool', 'cranky', 'crazy', 'dazzling', 'determined', 'distracted', 'dreamy', 'eager',
  'ecstatic', 'elastic', 'elated', 'elegant', 'eloquent', 'epic', 'exciting', 'fervent', 'festive',
  'flamboyant', 'focused', 'friendly', 'frosty', 'funny', 'gallant', 'gifted', 'goofy', 'gracious', 'great',
  'happy', 'hardcore', 'heuristic', 'hopeful', 'hungry', 'infallible', 'inspiring', 'intelligent',
  'interesting', 'jolly', 'jovial', 'keen', 'kind', 'laughing', 'loving', 'lucid', 'magical', 'modest',
  'musing', 'mystifying', 'naughty', 'nervous', 'nice', 'nifty', 'nostalgic', 'objective', 'optimistic',
  'peaceful', 'pedantic', 'pensive', 'practical', 'priceless', 'quirky', 'quizzical', 'recursing', 'relaxed',
  'reverent', 'romantic', 'sad', 'serene', 'sharp', 'silly', 'sleepy', 'stoic', 'strange', 'stupefied',
  'suspicious', 'sweet', 'tender', 'thirsty', 'trusting', 'unruffled', 'upbeat', 'vibrant', 'vigilant',
  'vigorous', 'wizardly', 'wonderful', 'xenodochial', 'youthful', 'zealous', 'zen',
]);

export const DOCKER_SURNAMES = new Set([
  'agnesi', 'albattani', 'allen', 'almeida', 'antonelli', 'archimedes', 'ardinghelli', 'aryabhata', 'austin',
  'babbage', 'banach', 'banzai', 'bardeen', 'bartik', 'bassi', 'beaver', 'bell', 'benz', 'bhabha',
  'bhaskara', 'black', 'blackburn', 'blackwell', 'bohr', 'booth', 'borg', 'bose', 'bouman', 'boyd',
  'brahmagupta', 'brattain', 'brown', 'buck', 'burnell', 'cannon', 'carson', 'cartwright', 'carver', 'cerf',
  'chandrasekhar', 'chaplygin', 'chatelet', 'chatterjee', 'chaum', 'chebyshev', 'clarke', 'cohen', 'colden',
  'cori', 'cray', 'curie', 'curran', 'darwin', 'davinci', 'dewdney', 'dhawan', 'diffie', 'dijkstra', 'dirac',
  'driscoll', 'dubinsky', 'easley', 'edison', 'einstein', 'elbakyan', 'elgamal', 'elion', 'ellis',
  'engelbart', 'euclid', 'euler', 'faraday', 'feistel', 'fermat', 'fermi', 'feynman', 'franklin', 'gagarin',
  'galileo', 'galois', 'ganguly', 'gates', 'gauss', 'germain', 'goldberg', 'goldstine', 'goldwasser',
  'golick', 'goodall', 'gould', 'greider', 'grothendieck', 'haibt', 'hamilton', 'haslett', 'hawking',
  'heisenberg', 'hellman', 'hermann', 'herschel', 'hertz', 'heyrovsky', 'hodgkin', 'hofstadter', 'hoover',
  'hopper', 'hugle', 'hypatia', 'ishizaka', 'jackson', 'jang', 'jemison', 'jennings', 'jepsen', 'johnson',
  'joliot', 'jones', 'kalam', 'kapitsa', 'kare', 'keldysh', 'keller', 'kepler', 'khayyam', 'khorana',
  'kilby', 'kirch', 'knuth', 'kowalevski', 'lalande', 'lamarr', 'lamport', 'leakey', 'leavitt', 'lederberg',
  'lehmann', 'lewin', 'lichterman', 'liskov', 'lovelace', 'lumiere', 'mahavira', 'margulis', 'matsumoto',
  'maxwell', 'mayer', 'mccarthy', 'mcclintock', 'mclaren', 'mclean', 'mcnulty', 'meitner', 'mendel',
  'mendeleev', 'meninsky', 'merkle', 'mestorf', 'mirzakhani', 'montalcini', 'moore', 'morse', 'moser',
  'murdock', 'napier', 'nash', 'neumann', 'newton', 'nightingale', 'nobel', 'noether', 'northcutt', 'noyce',
  'panini', 'pare', 'pascal', 'pasteur', 'payne', 'perlman', 'pike', 'poincare', 'poitras', 'proskuriakova',
  'ptolemy', 'raman', 'ramanujan', 'rhodes', 'ride', 'ritchie', 'robinson', 'roentgen', 'rosalind', 'rubin',
  'saha', 'sammet', 'sanderson', 'satoshi', 'shamir', 'shannon', 'shaw', 'shirley', 'shockley', 'shtern',
  'sinoussi', 'snyder', 'solomon', 'spence', 'stonebraker', 'sutherland', 'swanson', 'swartz', 'swirles',
  'taussig', 'tesla', 'tharp', 'thompson', 'torvalds', 'tu', 'turing', 'varahamihira', 'vaughan', 'villani',
  'visvesvaraya', 'volhard', 'wescoff', 'wilbur', 'wiles', 'williams', 'williamson', 'wilson', 'wing',
  'wozniak', 'wright', 'wu', 'yalow', 'yonath', 'zhukovsky',
]);

/** Whether a container name is one Docker auto-generated. */
export const isDockerRandomName = (name) => {
  if (typeof name !== 'string' || name === 'boring_wozniak') return false;
  const i = name.indexOf('_');
  if (i < 1 || name.indexOf('_', i + 1) !== -1) return false;
  return DOCKER_ADJECTIVES.has(name.slice(0, i)) && DOCKER_SURNAMES.has(name.slice(i + 1));
};

/**
 * Regex source (unescaped, unanchored) matching exactly what isDockerRandomName
 * accepts. `boring_wozniak` is carved out without lookahead (RE2 has none):
 * `boring` pairs with every surname but `wozniak`.
 */
export const DOCKER_RANDOM_NAME_ALTERNATION = (() => {
  const others = [...DOCKER_ADJECTIVES].filter((a) => a !== 'boring').join('|');
  const all = [...DOCKER_SURNAMES].join('|');
  const notWozniak = [...DOCKER_SURNAMES].filter((x) => x !== 'wozniak').join('|');
  return `(${others})_(${all})|boring_(${notWozniak})`;
})();
