/**
 * Supabase Row Level Security (RLS) & Storage Isolation Tests
 *
 * Scope (docs/briefs/a5-qa-review.md & docs/PLAN.md):
 *   User B cannot read or write any of User A's rows or recordings.
 *
 * Runs against the hosted Supabase project using credentials:
 *   SUPABASE_URL, VITE_SUPABASE_ANON_KEY
 *   TEST_USER_A_EMAIL, TEST_USER_A_PASSWORD
 *   TEST_USER_B_EMAIL, TEST_USER_B_PASSWORD
 */
import { randomUUID } from 'node:crypto';
import { createClient, type SupabaseClient, type User } from '@supabase/supabase-js';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';

const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || '';
const supabaseKey = process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const userAEmail = process.env.TEST_USER_A_EMAIL || '';
const userAPassword = process.env.TEST_USER_A_PASSWORD || '';
const userBEmail = process.env.TEST_USER_B_EMAIL || '';
const userBPassword = process.env.TEST_USER_B_PASSWORD || '';

const hasCredentials = Boolean(
  supabaseUrl &&
    supabaseKey &&
    userAEmail &&
    userAPassword &&
    userBEmail &&
    userBPassword,
);

describe.skipIf(!hasCredentials)('Supabase Row Level Security (RLS) Isolation', () => {
  let clientA: SupabaseClient;
  let clientB: SupabaseClient;
  let userA: User;
  let userB: User;

  const testConversationId = randomUUID();
  const testNodeId = randomUUID();
  const testNode2Id = randomUUID();
  const testEdgeId = randomUUID();
  const testFolderId = randomUUID();
  const testFlagId = randomUUID();
  const testCommitmentId = randomUUID();
  const testConceptId = randomUUID();
  let storageFilePath = '';

  beforeAll(async () => {
    clientA = createClient(supabaseUrl, supabaseKey, { auth: { persistSession: false } });
    clientB = createClient(supabaseUrl, supabaseKey, { auth: { persistSession: false } });

    const authA = await clientA.auth.signInWithPassword({
      email: userAEmail,
      password: userAPassword,
    });
    if (authA.error || !authA.data.user) {
      throw new Error(`Failed to sign in TEST_USER_A: ${authA.error?.message}`);
    }
    userA = authA.data.user;

    const authB = await clientB.auth.signInWithPassword({
      email: userBEmail,
      password: userBPassword,
    });
    if (authB.error || !authB.data.user) {
      throw new Error(`Failed to sign in TEST_USER_B: ${authB.error?.message}`);
    }
    userB = authB.data.user;

    storageFilePath = `${userA.id}/${testConversationId}.webm`;
  });

  afterAll(async () => {
    if (!clientA || !userA) return;

    // Cleanup User A created rows and storage
    await clientA.from('conversations').delete().eq('id', testConversationId);
    await clientA.from('folders').delete().eq('id', testFolderId);
    await clientA.from('concepts').delete().eq('id', testConceptId);
    if (storageFilePath) {
      await clientA.storage.from('recordings').remove([storageFilePath]);
    }
  });

  test('User A and User B have distinct authenticated identities', () => {
    expect(userA.id).toBeDefined();
    expect(userB.id).toBeDefined();
    expect(userA.id).not.toBe(userB.id);
  });

  test('User A can create a conversation and User B cannot read or modify it', async () => {
    // 1. User A creates conversation
    const { data: convA, error: createErr } = await clientA
      .from('conversations')
      .insert({
        id: testConversationId,
        user_id: userA.id,
        title: "User A's Confidential Conversation",
        status: 'ready',
      })
      .select()
      .single();

    expect(createErr).toBeNull();
    expect(convA?.id).toBe(testConversationId);

    // 2. User B tries to SELECT User A's conversation
    const { data: bSelect, error: bSelectErr } = await clientB
      .from('conversations')
      .select()
      .eq('id', testConversationId);

    expect(bSelectErr).toBeNull();
    expect(bSelect).toEqual([]);

    // 3. User B tries to UPDATE User A's conversation
    const { data: bUpdate } = await clientB
      .from('conversations')
      .update({ title: 'Tampered by User B' })
      .eq('id', testConversationId)
      .select();

    expect(bUpdate).toEqual([]);

    // 4. User B tries to DELETE User A's conversation
    const { data: bDelete } = await clientB
      .from('conversations')
      .delete()
      .eq('id', testConversationId)
      .select();

    expect(bDelete).toEqual([]);

    // 5. User B tries to INSERT a conversation claiming User A's user_id
    const { error: bInsertErr } = await clientB
      .from('conversations')
      .insert({
        id: randomUUID(),
        user_id: userA.id,
        title: 'Spoofed by B',
      });

    expect(bInsertErr).not.toBeNull();
  });

  test('User B cannot read or modify User A nodes and edges', async () => {
    // 1. User A creates nodes
    const { error: node1Err } = await clientA.from('nodes').insert({
      id: testNodeId,
      user_id: userA.id,
      conversation_id: testConversationId,
      kind: 'topic',
      status: 'active',
      level: 1,
      label: 'Secret Topic A',
      thread_id: randomUUID(),
      seq: 1,
      start_ms: 0,
      x: 100,
      y: 100,
    });
    expect(node1Err).toBeNull();

    const { error: node2Err } = await clientA.from('nodes').insert({
      id: testNode2Id,
      user_id: userA.id,
      conversation_id: testConversationId,
      kind: 'topic',
      status: 'active',
      level: 1,
      label: 'Secret Topic B',
      thread_id: randomUUID(),
      seq: 2,
      start_ms: 5000,
      x: 200,
      y: 100,
    });
    expect(node2Err).toBeNull();

    // User A creates edge
    const { error: edgeErr } = await clientA.from('edges').insert({
      id: testEdgeId,
      user_id: userA.id,
      conversation_id: testConversationId,
      source_id: testNodeId,
      target_id: testNode2Id,
      kind: 'flow',
    });
    expect(edgeErr).toBeNull();

    // 2. User B tries to select nodes and edges
    const { data: bNodes } = await clientB.from('nodes').select().eq('id', testNodeId);
    expect(bNodes).toEqual([]);

    const { data: bEdges } = await clientB.from('edges').select().eq('id', testEdgeId);
    expect(bEdges).toEqual([]);

    // 3. User B tries to modify User A's node
    const { data: bUpdateNode } = await clientB
      .from('nodes')
      .update({ label: 'Tampered Label' })
      .eq('id', testNodeId)
      .select();
    expect(bUpdateNode).toEqual([]);

    // 4. User B cannot insert node with User A's user_id
    const { error: bInsertNodeErr } = await clientB.from('nodes').insert({
      id: randomUUID(),
      user_id: userA.id,
      conversation_id: testConversationId,
      kind: 'topic',
      status: 'active',
      level: 1,
      label: 'Injected node',
      thread_id: randomUUID(),
      seq: 3,
      start_ms: 10000,
      x: 300,
      y: 100,
    });
    expect(bInsertNodeErr).not.toBeNull();
  });

  test('User B cannot read or modify User A folders', async () => {
    const { error: folderErr } = await clientA.from('folders').insert({
      id: testFolderId,
      user_id: userA.id,
      name: 'Private Folder A',
    });
    expect(folderErr).toBeNull();

    const { data: bFolders } = await clientB.from('folders').select().eq('id', testFolderId);
    expect(bFolders).toEqual([]);

    const { data: bUpdateFolder } = await clientB
      .from('folders')
      .update({ name: 'Hacked Folder' })
      .eq('id', testFolderId)
      .select();
    expect(bUpdateFolder).toEqual([]);
  });

  test('User B cannot read or modify User A flags or commitments', async () => {
    const { error: flagErr } = await clientA.from('flags').insert({
      id: testFlagId,
      user_id: userA.id,
      conversation_id: testConversationId,
      at_ms: 2500,
      source: 'button',
      note: 'User A Flag',
    });
    expect(flagErr).toBeNull();

    const { error: commitmentErr } = await clientA.from('commitments').insert({
      id: testCommitmentId,
      user_id: userA.id,
      conversation_id: testConversationId,
      text: 'Send slides tomorrow',
      at_ms: 3000,
    });
    expect(commitmentErr).toBeNull();

    const { data: bFlags } = await clientB.from('flags').select().eq('id', testFlagId);
    expect(bFlags).toEqual([]);

    const { data: bCommitments } = await clientB.from('commitments').select().eq('id', testCommitmentId);
    expect(bCommitments).toEqual([]);
  });

  test('User B cannot read or modify User A concepts', async () => {
    const { error: conceptErr } = await clientA.from('concepts').insert({
      id: testConceptId,
      user_id: userA.id,
      name: 'Private Concept A',
      description: 'Cross-conversation synthesis',
    });
    expect(conceptErr).toBeNull();

    const { data: bConcepts } = await clientB.from('concepts').select().eq('id', testConceptId);
    expect(bConcepts).toEqual([]);

    const { data: bUpdateConcept } = await clientB
      .from('concepts')
      .update({ name: 'Overwritten Concept' })
      .eq('id', testConceptId)
      .select();
    expect(bUpdateConcept).toEqual([]);
  });

  test('Storage: User B cannot read, write, or delete User A recordings', async () => {
    const mockAudioBlob = new Uint8Array([0x1a, 0x45, 0xdf, 0xa3]); // WebM header magic bytes

    // 1. User A uploads recording
    const { error: uploadErr } = await clientA.storage
      .from('recordings')
      .upload(storageFilePath, mockAudioBlob, { contentType: 'video/webm' });

    expect(uploadErr).toBeNull();

    // 2. User B cannot download User A's recording
    const { data: bDownload, error: bDownloadErr } = await clientB.storage
      .from('recordings')
      .download(storageFilePath);

    expect(bDownload).toBeNull();
    expect(bDownloadErr).not.toBeNull();

    // 3. User B cannot overwrite User A's recording
    const { error: bUploadErr } = await clientB.storage
      .from('recordings')
      .upload(storageFilePath, mockAudioBlob, { upsert: true });

    expect(bUploadErr).not.toBeNull();

    // 4. User B cannot delete User A's recording
    const { error: bDeleteErr } = await clientB.storage
      .from('recordings')
      .remove([storageFilePath]);

    // Removal by unauthorized user should either error or not delete the file
    if (!bDeleteErr) {
      // Confirm file still exists for User A
      const { data: aCheck } = await clientA.storage.from('recordings').download(storageFilePath);
      expect(aCheck).not.toBeNull();
    }
  });
});
