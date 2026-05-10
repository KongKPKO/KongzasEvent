// EventDetailHub — owner/manager landing page for a single event.
// Provides clear links to all event-scoped views without requiring users
// to remember subpath URLs (/dashboard, /history) or hunt through ManageArtist.

import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { supabase } from '../../supabaseClient';
import AdminHeader from '../../components/AdminHeader';
import type { ActorContext } from '../../types/access';
import {
  ArrowLeft,
  BarChart3,
  ClipboardList,
  Coffee,
  PlayCircle,
  ShoppingCart,
  Calendar,
  MapPin,
} from 'lucide-react';

interface EventRow {
  id: string;
  event_name: string;
  start_date: string;
  end_date: string;
  location: string | null;
  status: string;
  is_booth_open: boolean;
}

interface Props {
  actorContext: ActorContext;
}

export default function EventDetailHub({ actorContext }: Props) {
  const { eventId } = useParams<{ eventId: string }>();
  const navigate = useNavigate();
  const [event, setEvent] = useState<EventRow | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);

  useEffect(() => {
    if (!eventId) return;
    (async () => {
      setLoading(true);
      const { data, error } = await supabase
        .from('events')
        .select('id, event_name, start_date, end_date, location, status, is_booth_open')
        .eq('id', eventId)
        .eq('artist_id', actorContext.artist_id)
        .maybeSingle();
      if (error || !data) {
        setNotFound(true);
      } else {
        setEvent(data as EventRow);
      }
      setLoading(false);
    })();
  }, [eventId, actorContext.artist_id]);

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50">
        <AdminHeader activePage="events" actorRole={actorContext.role} />
        <main className="max-w-4xl mx-auto px-4 md:px-6 py-6">
          <p className="text-sm text-gray-500">Loading event…</p>
        </main>
      </div>
    );
  }

  if (notFound || !event) {
    return (
      <div className="min-h-screen bg-gray-50">
        <AdminHeader activePage="events" actorRole={actorContext.role} />
        <main className="max-w-4xl mx-auto px-4 md:px-6 py-6">
          <button
            type="button"
            onClick={() => navigate('/manage-events')}
            className="text-sm text-gray-500 hover:text-gray-800 inline-flex items-center gap-1 mb-4"
          >
            <ArrowLeft size={14} />
            Back to events
          </button>
          <div className="bg-white border border-gray-200 rounded-xl px-5 py-8 text-center">
            <p className="text-sm text-gray-500">Event not found.</p>
          </div>
        </main>
      </div>
    );
  }

  const cards: Array<{
    label: string;
    description: string;
    icon: typeof Coffee;
    href: string;
    accent: string;
    group: 'setup' | 'live' | 'analytics';
  }> = [
    {
      label: 'Event Products',
      description: 'Assign catalog items to this event and manage stock.',
      icon: Coffee,
      href: '/manage-products',
      accent: 'from-amber-50 to-amber-100 border-amber-200',
      group: 'setup',
    },
    {
      label: 'Live Queue',
      description: 'Call, serve, and manage the waiting list during the event.',
      icon: PlayCircle,
      href: '/live/queue',
      accent: 'from-pink-50 to-pink-100 border-pink-200',
      group: 'live',
    },
    {
      label: 'Live POS',
      description: 'Take checkout and record payments during the event.',
      icon: ShoppingCart,
      href: '/live/pos',
      accent: 'from-pink-50 to-pink-100 border-pink-200',
      group: 'live',
    },
    {
      label: 'Event Dashboard',
      description: 'Revenue, queue stats, and top products for this event.',
      icon: BarChart3,
      href: `/manage-events/${event.id}/dashboard`,
      accent: 'from-emerald-50 to-emerald-100 border-emerald-200',
      group: 'analytics',
    },
    {
      label: 'Order History',
      description: 'All orders placed at this event with payment details.',
      icon: ClipboardList,
      href: `/manage-events/${event.id}/history`,
      accent: 'from-emerald-50 to-emerald-100 border-emerald-200',
      group: 'analytics',
    },
  ];

  const groupLabel: Record<typeof cards[number]['group'], string> = {
    setup: 'Setup',
    live: 'Live Operation',
    analytics: 'Analytics',
  };

  const groups: Array<typeof cards[number]['group']> = ['setup', 'live', 'analytics'];

  const startDate = new Date(event.start_date);
  const dateLabel = startDate.toLocaleDateString('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });

  return (
    <div className="min-h-screen bg-gray-50">
      <AdminHeader activePage="events" actorRole={actorContext.role} />
      <main className="max-w-4xl mx-auto px-4 md:px-6 py-6">
        <button
          type="button"
          onClick={() => navigate('/manage-events')}
          className="text-sm text-gray-500 hover:text-gray-800 inline-flex items-center gap-1 mb-4"
        >
          <ArrowLeft size={14} />
          Back to events
        </button>

        <header className="mb-6">
          <div className="flex items-center gap-2 mb-1">
            <h1 className="text-2xl font-black text-gray-800 truncate">{event.event_name}</h1>
            <span
              className={`px-2 py-0.5 text-[10px] font-bold rounded-full uppercase tracking-wide ${
                event.is_booth_open
                  ? 'bg-pink-100 text-pink-700'
                  : 'bg-gray-100 text-gray-500'
              }`}
            >
              {event.is_booth_open ? 'Booth Open' : 'Booth Closed'}
            </span>
          </div>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-gray-500">
            <span className="inline-flex items-center gap-1">
              <Calendar size={13} />
              {dateLabel} · {event.status}
            </span>
            {event.location && (
              <span className="inline-flex items-center gap-1">
                <MapPin size={13} />
                {event.location}
              </span>
            )}
          </div>
        </header>

        {groups.map((group) => {
          const groupCards = cards.filter((c) => c.group === group);
          if (groupCards.length === 0) return null;
          return (
            <section key={group} className="mb-6">
              <h2 className="text-[11px] uppercase tracking-wider font-bold text-gray-500 mb-2">
                {groupLabel[group]}
              </h2>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {groupCards.map((card) => {
                  const Icon = card.icon;
                  return (
                    <button
                      key={card.label}
                      type="button"
                      onClick={() => navigate(card.href)}
                      className={`text-left bg-gradient-to-br ${card.accent} border rounded-xl px-4 py-4 hover:shadow-sm transition-shadow`}
                    >
                      <div className="flex items-start gap-3">
                        <Icon size={20} className="text-gray-700 mt-0.5 shrink-0" />
                        <div>
                          <p className="text-sm font-bold text-gray-800">{card.label}</p>
                          <p className="text-xs text-gray-600 mt-0.5">{card.description}</p>
                        </div>
                      </div>
                    </button>
                  );
                })}
              </div>
            </section>
          );
        })}
      </main>
    </div>
  );
}
