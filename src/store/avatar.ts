// Profile photos. A photo is cropped to a square and resized in the browser (256 × 256 JPEG), then stored in the
// private "avatars" storage bucket under the user's own folder: avatars/<user id>/<time>.jpg.
// The profile keeps only the path (profiles.avatar_path, set through the set_my_avatar() function).
// Everything here is optional: before migration 0006 is applied the app simply shows initials.
import { create } from 'zustand';
import { supabase, friendlyError } from '../lib/supabase.ts';

const BUCKET = 'avatars';
export const AVATAR_SIZE = 256;
export const AVATAR_MAX_INPUT_BYTES = 15 * 1024 * 1024;
export const AVATAR_TYPES = ['image/jpeg', 'image/png', 'image/webp'];

interface AvatarState {
  path: string | null;
  url: string | null;
  busy: boolean;
  load: (userId: string) => Promise<void>;
  upload: (userId: string, file: File) => Promise<void>;
  remove: () => Promise<void>;
  clear: () => void;
}

async function signedUrl(path: string): Promise<string | null> {
  const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(path, 60 * 60 * 12);
  return error ? null : data?.signedUrl ?? null;
}

/** Centre-crops the picture to a square and scales it to 256 × 256 px. */
export async function squareJpeg(file: File, size = AVATAR_SIZE): Promise<Blob> {
  if (!AVATAR_TYPES.includes(file.type)) throw new Error('Choose a JPG, PNG or WebP picture.');
  if (file.size > AVATAR_MAX_INPUT_BYTES) throw new Error('The picture is larger than 15 MB.');
  const bmp = await createImageBitmap(file).catch(() => { throw new Error('This picture could not be read.'); });
  const side = Math.min(bmp.width, bmp.height);
  const canvas = document.createElement('canvas');
  canvas.width = size; canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Your browser cannot resize pictures.');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, size, size);
  ctx.drawImage(bmp, (bmp.width - side) / 2, (bmp.height - side) / 2, side, side, 0, 0, size, size);
  bmp.close();
  return new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('The picture could not be converted.'))), 'image/jpeg', 0.86));
}

export const useAvatar = create<AvatarState>((set, get) => ({
  path: null, url: null, busy: false,

  load: async (userId) => {
    // A separate, non-fatal query: if the column does not exist yet, sign-in still works.
    const { data, error } = await supabase.from('profiles').select('avatar_path').eq('id', userId).maybeSingle();
    const path = error ? null : ((data as { avatar_path?: string | null } | null)?.avatar_path ?? null);
    set({ path, url: path ? await signedUrl(path) : null });
  },

  upload: async (userId, file) => {
    set({ busy: true });
    try {
      const blob = await squareJpeg(file);
      const path = `${userId}/${Date.now()}.jpg`;
      const up = await supabase.storage.from(BUCKET).upload(path, blob, { contentType: 'image/jpeg', upsert: false });
      if (up.error) throw up.error;
      const { error } = await supabase.rpc('set_my_avatar', { p_path: path });
      if (error) { await supabase.storage.from(BUCKET).remove([path]); throw error; }
      const old = get().path;
      if (old && old !== path) await supabase.storage.from(BUCKET).remove([old]);
      set({ path, url: (await signedUrl(path)) ?? URL.createObjectURL(blob) });
    } catch (e) {
      throw new Error(friendlyError(e));
    } finally { set({ busy: false }); }
  },

  remove: async () => {
    const old = get().path;
    set({ busy: true });
    try {
      const { error } = await supabase.rpc('set_my_avatar', { p_path: null });
      if (error) throw error;
      if (old) await supabase.storage.from(BUCKET).remove([old]);
      set({ path: null, url: null });
    } catch (e) {
      throw new Error(friendlyError(e));
    } finally { set({ busy: false }); }
  },

  clear: () => set({ path: null, url: null }),
}));
