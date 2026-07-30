import { supabase } from './supabase';
import { authorId as currentAuthorId } from '../stores/actorStore';
import type { Post, PostComment } from '../types';

export const feedService = {
  async getPosts(userId: string, page = 0, limit = 20): Promise<Post[]> {
    const { data, error } = await supabase
      .from('posts')
      .select(`*, profile:profiles!user_id(*), post_likes!left(user_id)`)
      .order('created_at', { ascending: false })
      .range(page * limit, (page + 1) * limit - 1);
    if (error) throw error;
    return (data ?? []).map((p: any) => ({
      ...p,
      is_liked: p.post_likes?.some((l: any) => l.user_id === userId) ?? false,
    }));
  },

  async createPost(userId: string, body: string, imageUrl?: string): Promise<Post> {
    const { data, error } = await supabase
      .from('posts')
      .insert({ user_id: currentAuthorId(userId) ?? userId, body, image_url: imageUrl ?? null })
      .select(`*, profile:profiles!user_id(*)`)
      .single();
    if (error) throw error;
    return { ...data, is_liked: false };
  },

  async deletePost(postId: string) {
    const { error } = await supabase.from('posts').delete().eq('id', postId);
    if (error) throw error;
  },

  async likePost(postId: string, userId: string) {
    const { error } = await supabase.from('post_likes').insert({ post_id: postId, user_id: currentAuthorId(userId) ?? userId });
    if (error && error.code !== '23505') throw error;
  },

  async unlikePost(postId: string, userId: string) {
    const { error } = await supabase.from('post_likes').delete().match({ post_id: postId, user_id: currentAuthorId(userId) ?? userId });
    if (error) throw error;
  },

  async getComments(postId: string): Promise<PostComment[]> {
    const { data, error } = await supabase
      .from('post_comments')
      .select(`*, profile:profiles!user_id(*)`)
      .eq('post_id', postId)
      .order('created_at', { ascending: true });
    if (error) throw error;
    return data ?? [];
  },

  async addComment(postId: string, userId: string, body: string): Promise<PostComment> {
    const { data, error } = await supabase
      .from('post_comments')
      .insert({ post_id: postId, user_id: currentAuthorId(userId) ?? userId, body })
      .select(`*, profile:profiles!user_id(*)`)
      .single();
    if (error) throw error;
    return data;
  },

  async deleteComment(commentId: string) {
    const { error } = await supabase.from('post_comments').delete().eq('id', commentId);
    if (error) throw error;
  },

  async sharePost(postId: string, userId: string, body: string) {
    const [shareResult, postResult] = await Promise.all([
      supabase.from('post_shares').insert({ original_post_id: postId, shared_by: userId }),
      supabase.from('posts').insert({ user_id: userId, body }).select().single(),
    ]);
    if (shareResult.error) throw shareResult.error;
    if (postResult.error) throw postResult.error;
    return postResult.data;
  },

  async uploadPostImage(userId: string, uri: string): Promise<string> {
    const ext = uri.split('.').pop() ?? 'jpg';
    const path = `posts/${userId}/${Date.now()}.${ext}`;
    const formData = new FormData();
    formData.append('file', { uri, name: path, type: `image/${ext}` } as any);
    const { error } = await supabase.storage.from('media').upload(path, formData);
    if (error) throw error;
    const { data } = supabase.storage.from('media').getPublicUrl(path);
    return data.publicUrl;
  },
};
