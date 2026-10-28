import { useEffect, useRef, useState } from 'react';
import { Box, Fab, IconButton, Paper, TextField, Typography } from '@mui/material';
import { useQuery } from '@tanstack/react-query';
import { api } from '../../api/client.js';

/**
 * A scripted assistant, not a language model. Every answer below is
 * computed from the same endpoints the admin screens already use, so a
 * figure it quotes can never disagree with the dashboard behind it.
 * Anything off the script is deflected rather than guessed at -- a wrong
 * number here would be read as authoritative.
 */

const DASH = '—';

function plural(n, one, many) {
  return `${n} ${n === 1 ? one : many}`;
}

/** "2 open, 1 full" from the dashboard's by_status map. */
function describeStatuses(byStatus = {}) {
  const parts = Object.entries(byStatus)
    .filter(([, count]) => count > 0)
    .map(([status, count]) => `${count} ${status.replace(/_/g, ' ')}`);
  return parts.join(', ');
}

const QUESTIONS = [
  {
    id: 'camp-count',
    label: 'How many camps are there?',
    match: /how many camps|camp count|number of camps|total camps/i,
    answer: ({ summary }) => {
      const breakdown = describeStatuses(summary.camps.by_status);
      return `There are ${plural(summary.camps.total, 'camp', 'camps')} in total${
        breakdown ? ` ${DASH} ${breakdown}` : ''
      }.`;
    },
  },
  {
    id: 'camps-open',
    label: 'Which camps are open right now?',
    match: /which camps|camps.*open|open camps|list.*camps/i,
    answer: ({ camps }) => {
      const open = camps.filter((c) => c.status === 'open');
      if (open.length === 0) return 'No camps are open right now.';
      return `${plural(open.length, 'camp is', 'camps are')} open right now:\n${open
        .map((c) => `• ${c.name}`)
        .join('\n')}`;
    },
  },
  {
    id: 'camp-officials',
    label: 'Who is the official for each camp?',
    match: /who is the official|camp official|which official|officials?.*camp/i,
    answer: ({ camps, officials }) => {
      const lines = camps.map((camp) => {
        const running = officials
          .filter((o) => (o.assigned_camp_ids ?? []).includes(camp.id))
          .map((o) => o.name);
        return `${camp.name} ${DASH} ${running.length ? running.join(', ') : 'no official assigned yet'}`;
      });
      return lines.length ? lines.join('\n') : 'There are no camps to report on yet.';
    },
  },
  {
    id: 'registered',
    label: 'How many people are registered?',
    match: /how many.*registered|registration count|total registered|how many people/i,
    answer: ({ summary }) =>
      `${plural(summary.beneficiaries.total_registered, 'household is', 'households are')} registered, ` +
      `and ${plural(summary.beneficiaries.total_checked_in, 'person has', 'people have')} checked in.`,
  },
  {
    id: 'checked-in',
    label: 'How many have checked in?',
    match: /checked in|check-in count|arrivals/i,
    answer: ({ summary }) =>
      `${plural(summary.beneficiaries.total_checked_in, 'person has', 'people have')} checked in so far.`,
  },
  {
    id: 'high-priority',
    label: 'How many are high priority?',
    match: /high priority|priority cases|vulnerable/i,
    answer: ({ summary }) =>
      `${plural(summary.beneficiaries.high_priority, 'person is', 'people are')} marked high priority.`,
  },
  {
    id: 'volunteers',
    label: 'How many volunteers are active?',
    match: /volunteer/i,
    answer: ({ summary }) =>
      `${summary.volunteers.active} active, ${summary.volunteers.accepted} accepted and ` +
      `${summary.volunteers.completed} completed.`,
  },
  {
    id: 'capacity',
    label: 'Is camp capacity running out?',
    match: /capacity|how full|space left|room left/i,
    answer: ({ summary }) => {
      const { beneficiary_capacity: cap, beneficiaries_accepted: taken } = summary.camps;
      const free = Math.max(cap - taken, 0);
      const pct = cap > 0 ? Math.round((taken / cap) * 100) : 0;
      return `${taken} of ${cap} places are taken (${pct}%). ${plural(free, 'place', 'places')} still free.`;
    },
  },
  {
    id: 'supplies',
    label: 'Are any supplies running low?',
    match: /supplies|stock|inventory|expiry|expired/i,
    answer: ({ summary }) => {
      const { low_stock: low, near_expiry: near, expired } = summary.inventory;
      if (low + near + expired === 0) return 'Nothing is low, near expiry or expired. Inventory looks healthy.';
      return `${plural(low, 'item is', 'items are')} low on stock, ${near} near expiry and ${expired} already expired.`;
    },
  },
  {
    id: 'alerts',
    label: 'Are there any active flood alerts?',
    match: /flood|alert|affected area/i,
    answer: ({ summary }) =>
      `${plural(summary.flood_monitoring.active_alerts, 'active alert', 'active alerts')} across ` +
      `${plural(summary.flood_monitoring.affected_areas, 'affected area', 'affected areas')}.`,
  },
  {
    id: 'emergencies',
    label: 'Are there any pending emergencies?',
    match: /emergency|emergencies|sos|rescue/i,
    answer: ({ summary }) => {
      const e = summary.emergency ?? {};
      const open = e.open ?? 0;
      if (open === 0) return 'No open SOS calls right now.';
      return `${plural(open, 'SOS call is', 'SOS calls are')} still open (${e.medical ?? 0} medical, ${
        e.security ?? 0
      } security). ${e.resolved ?? 0} resolved.`;
    },
  },
];

const GREETING = 'Hi! I can look up anything on this dashboard. Pick a question below.';
const THINKING = 'Let me think…';
const DEFLECTION = `That needs a deeper look at the records ${DASH} I'll get back to you on that.`;

/** Returns the scripted question a typed message is asking for, or null. */
function matchQuestion(text) {
  const trimmed = text.trim();
  if (!trimmed) return null;
  return QUESTIONS.find((q) => q.match.test(trimmed)) ?? null;
}

function TypingDots() {
  return (
    <Box component="span" aria-label="Thinking" sx={{ display: 'inline-flex', gap: 0.5, pl: 0.25 }}>
      {[0, 1, 2].map((i) => (
        <Box
          key={i}
          component="span"
          sx={{
            width: 6,
            height: 6,
            borderRadius: '50%',
            bgcolor: '#C44E00',
            animation: 'frpBlink 1.2s infinite ease-in-out',
            animationDelay: `${i * 0.18}s`,
            '@keyframes frpBlink': {
              '0%, 80%, 100%': { opacity: 0.25 },
              '40%': { opacity: 1 },
            },
          }}
        />
      ))}
    </Box>
  );
}

function Bubble({ mine, children }) {
  return (
    <Box sx={{ display: 'flex', justifyContent: mine ? 'flex-end' : 'flex-start' }}>
      <Typography
        sx={{
          maxWidth: '85%',
          px: 1.5,
          py: 1,
          borderRadius: mine ? '12px 12px 2px 12px' : '12px 12px 12px 2px',
          bgcolor: mine ? '#FF6B00' : '#FFF4EC',
          color: mine ? '#fff' : '#2B2B2B',
          fontSize: 13.5,
          lineHeight: 1.55,
          whiteSpace: 'pre-line',
        }}
      >
        {children}
      </Typography>
    </Box>
  );
}

export function AdminChatbot() {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState('');
  const [messages, setMessages] = useState([{ id: 'greet', from: 'bot', kind: 'text', text: GREETING }]);
  const nextId = useRef(0);
  const endRef = useRef(null);
  const timers = useRef([]);

  // The chat only fetches once it is opened, and reuses the query keys the
  // admin pages already use -- on the dashboard the answers come straight
  // from cache with no extra request.
  const summaryQuery = useQuery({
    queryKey: ['dashboard', 'summary'],
    queryFn: async () => (await api.get('/dashboard/summary')).data,
    enabled: open,
  });
  const campsQuery = useQuery({
    queryKey: ['camps', {}],
    queryFn: async () => (await api.get('/camps')).data.camps,
    enabled: open,
  });
  const officialsQuery = useQuery({
    queryKey: ['auth', 'officials'],
    queryFn: async () => (await api.get('/auth/officials')).data.officials,
    enabled: open,
  });

  const data = {
    summary: summaryQuery.data,
    camps: campsQuery.data ?? [],
    officials: officialsQuery.data ?? [],
  };

  // Pending timers would otherwise fire into an unmounted component when the
  // admin navigates away mid-answer.
  useEffect(() => () => timers.current.forEach(clearTimeout), []);

  useEffect(() => {
    // jsdom has no scrollIntoView, and neither do very old browsers; the
    // panel simply stays where it is rather than throwing mid-render.
    if (typeof endRef.current?.scrollIntoView === 'function') {
      endRef.current.scrollIntoView({ block: 'end' });
    }
  }, [messages, open]);

  function later(fn, ms) {
    timers.current.push(setTimeout(fn, ms));
  }

  function push(message) {
    const id = `m${nextId.current++}`;
    setMessages((prev) => [...prev, { ...message, id }]);
    return id;
  }

  function ask(question, asTyped) {
    push({ from: 'user', kind: 'text', text: asTyped ?? question.label });
    const pendingId = push({ from: 'bot', kind: 'answer', questionId: question.id, pending: true });
    later(() => {
      setMessages((prev) => prev.map((m) => (m.id === pendingId ? { ...m, pending: false } : m)));
    }, 900);
  }

  function deflect(text) {
    push({ from: 'user', kind: 'text', text });
    const pendingId = push({ from: 'bot', kind: 'text', text: THINKING, pending: true });
    later(() => {
      setMessages((prev) => prev.map((m) => (m.id === pendingId ? { ...m, pending: false } : m)));
      push({ from: 'bot', kind: 'text', text: DEFLECTION });
    }, 1500);
  }

  function submitDraft(event) {
    event.preventDefault();
    const text = draft.trim();
    if (!text) return;
    setDraft('');
    const question = matchQuestion(text);
    if (question) ask(question, text);
    else deflect(text);
  }

  function renderBody(message) {
    if (message.kind === 'answer') {
      if (message.pending) return <TypingDots />;
      const question = QUESTIONS.find((q) => q.id === message.questionId);
      if (!question) return DEFLECTION;
      if (!data.summary) return 'One moment — still pulling the latest numbers.';
      return question.answer(data);
    }
    return (
      <>
        {message.text}
        {message.pending && <TypingDots />}
      </>
    );
  }

  return (
    <>
      {open && (
        <Paper
          elevation={8}
          sx={{
            position: 'fixed',
            right: 24,
            bottom: 92,
            zIndex: 1300,
            width: { xs: 'calc(100vw - 48px)', sm: 348 },
            maxHeight: 'min(70vh, 520px)',
            display: 'flex',
            flexDirection: 'column',
            borderRadius: '14px',
            overflow: 'hidden',
            border: '1px solid #EFE6DC',
          }}
        >
          <Box
            sx={{
              display: 'flex',
              alignItems: 'center',
              gap: 1,
              px: 1.75,
              py: 1.25,
              bgcolor: '#FFF0E4',
              borderBottom: '1px solid #EFE6DC',
            }}
          >
            <Box sx={{ fontSize: 18 }}>🤖</Box>
            <Box sx={{ mr: 'auto' }}>
              <Typography sx={{ fontFamily: '"Lora", Georgia, serif', fontWeight: 600, fontSize: 14 }}>
                Relief Assistant
              </Typography>
              <Typography sx={{ fontSize: 11, color: '#8A8A8A' }}>Answers from live camp data</Typography>
            </Box>
            <IconButton size="small" aria-label="Close assistant" onClick={() => setOpen(false)}>
              <Box sx={{ fontSize: 15, lineHeight: 1, color: '#6B6B6B' }}>✕</Box>
            </IconButton>
          </Box>

          <Box sx={{ flex: 1, overflowY: 'auto', px: 1.75, py: 1.5, display: 'grid', gap: 1 }}>
            {messages.map((message) => (
              <Bubble key={message.id} mine={message.from === 'user'}>
                {renderBody(message)}
              </Bubble>
            ))}
            <div ref={endRef} />
          </Box>

          <Box sx={{ px: 1.75, pt: 1, pb: 0.5, borderTop: '1px solid #EFE6DC', bgcolor: '#FFFBF7' }}>
            <Typography sx={{ fontSize: 10.5, color: '#8A8A8A', textTransform: 'uppercase', letterSpacing: 0.4 }}>
              Suggested questions
            </Typography>
            <Box sx={{ display: 'flex', gap: 0.75, flexWrap: 'wrap', py: 1, maxHeight: 108, overflowY: 'auto' }}>
              {QUESTIONS.map((question) => (
                <Box
                  key={question.id}
                  component="button"
                  type="button"
                  onClick={() => ask(question)}
                  sx={{
                    border: '1px solid #F0D9C6',
                    bgcolor: '#fff',
                    color: '#C44E00',
                    borderRadius: 999,
                    px: 1.25,
                    py: 0.6,
                    fontSize: 12,
                    fontWeight: 600,
                    cursor: 'pointer',
                    fontFamily: 'inherit',
                    '&:hover': { bgcolor: '#FFF4EC' },
                  }}
                >
                  {question.label}
                </Box>
              ))}
            </Box>
          </Box>

          <Box component="form" onSubmit={submitDraft} sx={{ display: 'flex', gap: 1, p: 1.25, pt: 0.5 }}>
            <TextField
              size="small"
              fullWidth
              placeholder="Ask something…"
              slotProps={{ htmlInput: { 'aria-label': 'Message' } }}
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
            />
            <Box
              component="button"
              type="submit"
              aria-label="Send message"
              sx={{
                border: 0,
                bgcolor: '#FF6B00',
                color: '#fff',
                borderRadius: '9px',
                px: 1.5,
                fontSize: 14,
                cursor: 'pointer',
              }}
            >
              ➤
            </Box>
          </Box>
        </Paper>
      )}

      <Fab
        aria-label={open ? 'Close assistant' : 'Open assistant'}
        onClick={() => setOpen((wasOpen) => !wasOpen)}
        sx={{
          position: 'fixed',
          right: 24,
          bottom: 24,
          zIndex: 1300,
          bgcolor: '#FF6B00',
          color: '#fff',
          fontSize: 24,
          '&:hover': { bgcolor: '#E25F00' },
        }}
      >
        {open ? '✕' : '🤖'}
      </Fab>
    </>
  );
}
