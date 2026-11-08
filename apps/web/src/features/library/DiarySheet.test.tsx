import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeAll, describe, expect, it } from 'vitest';
import { createMockApi } from '../../lib/api';
import { loadDemoGraph } from '../../lib/fixtures';
import { renderApp } from '../../test/render';
import { installFlowDomStubs } from '../map/testing';
import { REFLECTION_PROMPT } from './DiarySheet';
import { composePromise, parsePromise } from './promises';

// /c/:id renders A3's React Flow map, which needs these jsdom stubs
beforeAll(() => installFlowDomStubs());

const demo = loadDemoGraph();
const id = demo.conversation.id;
const resurrection = Object.values(demo.nodes).find((n) => n.label === 'Resurrection Accounts')!;

async function openDiary(api = createMockApi()) {
  const user = userEvent.setup();
  renderApp({ route: `/c/${id}`, api });
  const button = await screen.findByRole('button', { name: 'Open diary' });
  await waitFor(() => expect(button).toBeEnabled()); // enabled once the graph has loaded
  await user.click(button);
  return { api, user, diary: screen.getByRole('dialog', { name: 'Diary' }) };
}

describe('diary sheet', () => {
  it('shows the conversation metadata', async () => {
    const { diary } = await openDiary();
    expect(within(diary).getByRole('textbox', { name: 'Title' })).toHaveValue(demo.conversation.title);
    expect(within(diary).getByText('10 min')).toBeInTheDocument();
    expect(within(diary).getByText('Group')).toBeInTheDocument();
    expect(within(diary).getByRole('textbox', { name: 'Place' })).toHaveValue('Koerner Library cafe');
  });

  it('edits to title, place and reflection persist after closing and reopening', async () => {
    const { api, user, diary } = await openDiary();
    const title = within(diary).getByRole('textbox', { name: 'Title' });
    await user.clear(title);
    await user.type(title, 'Sam on faith{Enter}');

    const place = within(diary).getByRole('textbox', { name: 'Place' });
    await user.clear(place);
    await user.type(place, 'The bus home');

    const reflection = within(diary).getByRole('textbox', { name: REFLECTION_PROMPT });
    await user.clear(reflection);
    await user.type(reflection, 'Ask Sam about Camus next time.');
    await user.tab(); // blur saves

    await waitFor(async () => {
      const c = (await api.getGraph(id)).conversation;
      expect(c).toMatchObject({
        title: 'Sam on faith',
        location: 'The bus home',
        reflection: 'Ask Sam about Camus next time.',
      });
    });

    await user.click(within(diary).getByRole('button', { name: 'Close' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Sam on faith');

    await user.click(screen.getByRole('button', { name: 'Open diary' }));
    const reopened = screen.getByRole('dialog', { name: 'Diary' });
    expect(within(reopened).getByRole('textbox', { name: 'Place' })).toHaveValue('The bus home');
    expect(within(reopened).getByRole('textbox', { name: REFLECTION_PROMPT })).toHaveValue(
      'Ask Sam about Camus next time.',
    );
  });

  it('an unchanged field is not saved', async () => {
    const api = createMockApi();
    let calls = 0;
    const update = api.updateConversation.bind(api);
    api.updateConversation = async (...args) => {
      calls++;
      return update(...args);
    };
    const { user, diary } = await openDiary(api);
    await user.click(within(diary).getByRole('textbox', { name: 'Place' }));
    await user.tab();
    expect(calls).toBe(0);
  });

  it('adds and removes participants', async () => {
    const { api, user, diary } = await openDiary();
    await user.type(within(diary).getByRole('textbox', { name: 'Add a participant' }), 'Sam{Enter}');
    expect(await within(diary).findByText('Sam')).toBeInTheDocument();
    expect((await api.listParticipants([id])).map((p) => p.displayName)).toEqual(['Sam']);

    await user.click(within(diary).getByRole('button', { name: 'Remove Sam' }));
    await waitFor(() => expect(within(diary).queryByText('Sam')).not.toBeInTheDocument());
    expect(await api.listParticipants([id])).toEqual([]);
  });

  it('lists open threads (deferred and parked) but not resolved ones', async () => {
    const { diary } = await openDiary();
    const section = within(diary).getByRole('region', { name: 'Open threads' });
    expect(within(section).getByText('Intramural Soccer')).toBeInTheDocument();
    expect(within(section).getByText(/Deferred, never picked up/)).toBeInTheDocument();
    expect(within(section).getByText('Ask About Internship')).toBeInTheDocument();
    expect(within(section).getByText(/Parked thought/)).toBeInTheDocument();
    expect(within(section).queryByText('Summer Road Trip')).not.toBeInTheDocument();
    expect(within(section).getByRole('link', { name: 'Show Intramural Soccer on the map' })).toHaveAttribute(
      'href',
      expect.stringContaining(`/c/${id}?node=`),
    );
  });

  it('phrases promises as "When ___, I will ___" and saves the cue and done state', async () => {
    const { api, user, diary } = await openDiary();
    const section = within(diary).getByRole('region', { name: 'Promises' });
    expect(section).toHaveTextContent('send Sam the reading list on the resurrection debate');

    await user.type(within(section).getByRole('textbox', { name: 'When should you do this?' }), 'I get home tonight');
    await user.tab();
    await waitFor(async () =>
      expect((await api.getGraph(id)).commitments[0]!.text).toBe(
        'When I get home tonight, I will send Sam the reading list on the resurrection debate',
      ),
    );

    // the tap target is the 44 px label around the 24 px box: tapping its edge toggles it too
    const target = within(section).getByTestId('promise-done-target');
    expect(target.className).toContain('size-11');
    expect(target).toContainElement(within(section).getByRole('checkbox', { name: 'Done' }));
    await user.click(target);
    await waitFor(async () => expect((await api.getGraph(id)).commitments[0]!.done).toBe(true));
  });

  it('recall cards ask first, then reveal the node and record the result', async () => {
    const api = createMockApi(undefined, {
      recallCards: [
        {
          id: 'r1',
          conversationId: id,
          nodeId: resurrection.id,
          prompt: 'What did Sam say about the resurrection?',
          dueAt: null,
          lastResult: null,
        },
      ],
    });
    const { user, diary } = await openDiary(api);
    const section = within(diary).getByRole('region', { name: 'Recall cards' });
    await within(section).findByText('What did Sam say about the resurrection?');
    expect(within(section).queryByText(resurrection.summary)).not.toBeInTheDocument();

    await user.type(within(section).getByRole('textbox', { name: 'Your answer' }), 'The accounts disagree');
    await user.click(within(section).getByRole('button', { name: 'Reveal' }));
    expect(within(section).getByText(resurrection.summary)).toBeInTheDocument();
    expect(within(section).getByText('The accounts disagree')).toBeInTheDocument();
    expect(within(section).getByRole('button', { name: /^Play Resurrection Accounts at/ })).toBeInTheDocument();

    await user.click(within(section).getByRole('button', { name: 'I remembered' }));
    await waitFor(async () => expect((await api.listRecallCards(id))[0]!.lastResult).toBe('remembered'));
  });

  it('renders the header while the graph is still loading', () => {
    const api = createMockApi();
    api.getGraph = () => new Promise(() => {});
    renderApp({ route: `/c/${id}`, api });
    expect(screen.getByText('Loading conversation…')).toHaveAttribute('role', 'status');
    expect(screen.getByRole('button', { name: 'Open diary' })).toBeDisabled();
  });

  it('?diary=1 opens the diary on arrival', async () => {
    renderApp({ route: `/c/${id}?diary=1` });
    expect(await screen.findByRole('dialog', { name: 'Diary' })).toBeInTheDocument();
  });

  it('an unknown conversation shows an error with a way home', async () => {
    renderApp({ route: '/c/does-not-exist' });
    expect(await screen.findByRole('alert')).toHaveTextContent(/couldn’t open this conversation/);
  });
});

describe('promise phrasing', () => {
  it('parses and composes if-then promises', () => {
    expect(parsePromise('Send Sam the reading list')).toEqual({ cue: null, action: 'send Sam the reading list' });
    expect(parsePromise("I'll send you the paper tonight")).toEqual({
      cue: null,
      action: 'send you the paper tonight',
    });
    expect(parsePromise('When I get home, I will call Mum')).toEqual({ cue: 'I get home', action: 'call Mum' });
    expect(composePromise('I get home.', 'Call Mum')).toBe('When I get home, I will call Mum');
    expect(composePromise('', 'send the paper')).toBe('Send the paper');
    expect(parsePromise('NASA forms by Friday').action).toBe('NASA forms by Friday');
  });
});
