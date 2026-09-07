// Bootstrap. Chooses the entry screen from whether an avatar already exists,
// so a returning user lands straight on the talking screen and never re-shoots
// their photographs.
import { createRouter } from './ui/router';
import { AvatarStore } from './store/avatarStore';
import { WelcomeScreen } from './ui/screens/welcome';
import { TalkScreen } from './ui/screens/talk';

async function boot() {
  const host = document.getElementById('app');
  if (!host) throw new Error('#app missing');

  const nav = createRouter(host);
  const store = new AvatarStore();
  const avatar = await store.loadAvatar().catch(() => null);

  await nav.go(avatar ? new TalkScreen(avatar, store) : new WelcomeScreen(store));
}

boot().catch((err) => {
  console.error(err);
  document.body.textContent = 'Something went wrong starting the app.';
});
