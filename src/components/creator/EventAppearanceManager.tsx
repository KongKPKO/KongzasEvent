import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent } from 'react';
import {
  CalendarDays,
  Clock3,
  Eye,
  EyeOff,
  ImagePlus,
  MapPin,
  Pencil,
  Plus,
  Sparkles,
  Trash2,
  X,
} from 'lucide-react';
import { useDialogFocus } from '../../hooks/useDialogFocus';
import { supabase } from '../../supabaseClient';
import { uploadImage as uploadValidatedImage } from '../../lib/imageUploads';
import type { AppearanceEventContext, EventAppearance, EventAppearanceDraft } from '../../types/eventAppearance';
import {
  appearanceToDraft,
  createEmptyAppearanceDraft,
  formatAppearanceTimeRange,
  sortEventAppearances,
  toDateInputValue,
  validateAppearanceDraft,
} from '../../lib/eventAppearances';
import { getMenuImageUrl } from '../../utils/imageUtils';

interface EventAppearanceManagerProps {
  event: AppearanceEventContext;
}

const getNullableValue = (value: string) => value.trim() || null;

const EventAppearanceManager = ({ event }: EventAppearanceManagerProps) => {
  const [appearances, setAppearances] = useState<EventAppearance[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [formError, setFormError] = useState('');
  const [editing, setEditing] = useState<EventAppearance | null>(null);
  const [draft, setDraft] = useState<EventAppearanceDraft | null>(null);
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [imagePreview, setImagePreview] = useState('');
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const timeZone = event.event_timezone || Intl.DateTimeFormat().resolvedOptions().timeZone || 'Asia/Bangkok';
  const dateRange = useMemo(() => ({
    min: toDateInputValue(event.start_date, timeZone),
    max: toDateInputValue(event.end_date, timeZone),
  }), [event.end_date, event.start_date, timeZone]);

  const fetchAppearances = useCallback(async () => {
    setLoading(true);
    setLoadError('');
    const { data, error } = await supabase
      .from('event_appearances')
      .select('*')
      .eq('event_id', event.id)
      .order('appearance_date', { ascending: true })
      .order('sort_order', { ascending: true })
      .order('created_at', { ascending: true });

    if (error) {
      console.error('[EventAppearanceManager] load failed:', error);
      setLoadError('Could not load the Cosplan. Please retry.');
      setAppearances([]);
    } else {
      setAppearances(sortEventAppearances((data || []) as EventAppearance[]));
    }
    setLoading(false);
  }, [event.id]);

  useEffect(() => {
    void fetchAppearances();
  }, [fetchAppearances]);

  useEffect(() => {
    if (!imageFile) {
      setImagePreview('');
      return;
    }
    const nextPreview = URL.createObjectURL(imageFile);
    setImagePreview(nextPreview);
    return () => URL.revokeObjectURL(nextPreview);
  }, [imageFile]);

  const closeForm = () => {
    if (saving) return;
    setDraft(null);
    setEditing(null);
    setImageFile(null);
    setImagePreview('');
    setFormError('');
    if (imageInputRef.current) imageInputRef.current.value = '';
  };

  const dialogRef = useDialogFocus<HTMLDivElement>(Boolean(draft), closeForm);

  const openCreate = () => {
    setEditing(null);
    setDraft(createEmptyAppearanceDraft(dateRange.min, {
      booth: event.booth_detail || event.booth_number,
    }));
    setImageFile(null);
    setFormError('');
  };

  const openEdit = (appearance: EventAppearance) => {
    setEditing(appearance);
    setDraft(appearanceToDraft(appearance));
    setImageFile(null);
    setFormError('');
  };

  const updateDraft = (field: keyof EventAppearanceDraft, value: string | boolean) => {
    setDraft((current) => current ? { ...current, [field]: value } : current);
  };

  const handleImageChange = (changeEvent: ChangeEvent<HTMLInputElement>) => {
    const file = changeEvent.target.files?.[0] || null;
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      setFormError('Choose an image file.');
      changeEvent.target.value = '';
      return;
    }
    if (file.size > 8 * 1024 * 1024) {
      setFormError('Image must be 8 MB or smaller.');
      changeEvent.target.value = '';
      return;
    }
    setFormError('');
    setImageFile(file);
  };

  const uploadImage = (file: File) => uploadValidatedImage(file, 'product', { artistId: event.artist_id });

  const handleSave = async () => {
    if (!draft || saving) return;
    const validationError = validateAppearanceDraft(draft, dateRange);
    if (validationError) {
      setFormError(validationError);
      return;
    }

    setSaving(true);
    setFormError('');
    let uploadedPath = '';
    try {
      if (imageFile) uploadedPath = await uploadImage(imageFile);
      const imageUrl = uploadedPath || draft.image_url.trim() || null;
      const payload = {
        artist_id: event.artist_id,
        event_id: event.id,
        character_name: draft.character_name.trim(),
        series_name: getNullableValue(draft.series_name),
        image_url: imageUrl,
        appearance_date: draft.appearance_date,
        day_label: getNullableValue(draft.day_label),
        start_time: getNullableValue(draft.start_time),
        end_time: getNullableValue(draft.end_time),
        note: getNullableValue(draft.note),
        booth: getNullableValue(draft.booth),
        zone: getNullableValue(draft.zone),
        is_public: draft.is_public,
      };

      const result = editing
        ? await supabase.from('event_appearances').update(payload).eq('id', editing.id).eq('artist_id', event.artist_id).select('*').single()
        : await supabase.from('event_appearances').insert({ ...payload, sort_order: appearances.length }).select('*').single();

      if (result.error) throw result.error;

      const oldImagePath = editing?.image_url || '';
      if (oldImagePath.startsWith(`public/appearances/${event.artist_id}/${event.id}/`) && oldImagePath !== imageUrl) {
        const { error: removeError } = await supabase.storage.from('Menu').remove([oldImagePath]);
        if (removeError) console.warn('[EventAppearanceManager] old image cleanup failed:', removeError);
      }

      setDraft(null);
      setEditing(null);
      setImageFile(null);
      setImagePreview('');
      setFormError('');
      if (imageInputRef.current) imageInputRef.current.value = '';
      await fetchAppearances();
    } catch (error) {
      console.error('[EventAppearanceManager] save failed:', error);
      // Validated uploads can also be referenced by products; preserve them on a failed save.
      setFormError(error instanceof Error ? error.message : 'Could not save this appearance.');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (appearance: EventAppearance) => {
    const confirmed = window.confirm(`Remove ${appearance.character_name} from this event's Cosplan?`);
    if (!confirmed) return;
    setDeletingId(appearance.id);
    setLoadError('');
    const { error } = await supabase
      .from('event_appearances')
      .delete()
      .eq('id', appearance.id)
      .eq('artist_id', event.artist_id);
    if (error) {
      console.error('[EventAppearanceManager] delete failed:', error);
      setLoadError('Could not remove the appearance. Please retry.');
    } else {
      if (appearance.image_url?.startsWith(`public/appearances/${event.artist_id}/${event.id}/`)) {
        const { error: removeError } = await supabase.storage.from('Menu').remove([appearance.image_url]);
        if (removeError) console.warn('[EventAppearanceManager] image cleanup failed:', removeError);
      }
      setAppearances((current) => current.filter((item) => item.id !== appearance.id));
    }
    setDeletingId(null);
  };

  return (
    <section className="mb-5 rounded-xl border border-fuchsia-100 bg-white p-4 shadow-sm md:p-5" aria-labelledby="event-appearance-heading">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex min-w-0 gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-fuchsia-50 text-fuchsia-700">
            <Sparkles size={20} aria-hidden="true" />
          </div>
          <div>
            <p className="text-xs font-black uppercase tracking-wide text-fuchsia-600">Optional</p>
            <h2 id="event-appearance-heading" className="text-lg font-black text-gray-900">Cosplan / Event appearance</h2>
            <p className="mt-1 max-w-2xl text-sm font-semibold leading-5 text-gray-500">
              Share who you will cosplay, when visitors can meet you, and where to find you. Skip this section if it does not fit your event.
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={openCreate}
          className="workspace-action inline-flex min-h-11 shrink-0 items-center justify-center gap-2 bg-fuchsia-600 px-4 text-sm font-black text-white hover:bg-fuchsia-700"
        >
          <Plus size={17} aria-hidden="true" />
          Add appearance
        </button>
      </div>

      {loadError && (
        <div role="alert" className="mt-4 flex items-center justify-between gap-3 rounded-lg border border-red-100 bg-red-50 px-3 py-2 text-sm font-bold text-red-700">
          <span>{loadError}</span>
          <button type="button" onClick={() => void fetchAppearances()} className="min-h-10 rounded-lg px-3 underline">Retry</button>
        </div>
      )}

      {loading ? (
        <p className="mt-4 text-sm font-semibold text-gray-400">Loading Cosplan...</p>
      ) : appearances.length === 0 ? (
        <div className="mt-4 rounded-xl border border-dashed border-gray-200 bg-gray-50/70 px-4 py-5 text-center">
          <p className="text-sm font-black text-gray-700">No appearance added</p>
          <p className="mt-1 text-xs font-semibold text-gray-500">This event stays clean and works normally without one.</p>
        </div>
      ) : (
        <div className="mt-4 grid gap-3 md:grid-cols-2" data-testid="event-appearance-list">
          {appearances.map((appearance) => {
            const timeLabel = formatAppearanceTimeRange(appearance);
            return (
              <article key={appearance.id} className="flex min-w-0 gap-3 rounded-xl border border-gray-100 bg-gray-50/70 p-3">
                <div className="h-24 w-20 shrink-0 overflow-hidden rounded-lg bg-fuchsia-50">
                  {appearance.image_url ? (
                    <img src={getMenuImageUrl(appearance.image_url)} alt={`${appearance.character_name} appearance`} className="h-full w-full object-cover" />
                  ) : (
                    <div className="flex h-full w-full items-center justify-center text-fuchsia-300"><Sparkles size={24} aria-hidden="true" /></div>
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <h3 className="truncate text-sm font-black text-gray-900">{appearance.character_name}</h3>
                      {appearance.series_name && <p className="truncate text-xs font-bold text-fuchsia-700">{appearance.series_name}</p>}
                    </div>
                    <span className={`inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-1 text-[10px] font-black ${appearance.is_public ? 'bg-emerald-50 text-emerald-700' : 'bg-gray-200 text-gray-600'}`}>
                      {appearance.is_public ? <Eye size={11} aria-hidden="true" /> : <EyeOff size={11} aria-hidden="true" />}
                      {appearance.is_public ? 'Public' : 'Hidden'}
                    </span>
                  </div>
                  <div className="mt-2 space-y-1 text-xs font-semibold text-gray-600">
                    <p className="flex items-center gap-1.5"><CalendarDays size={13} aria-hidden="true" />{appearance.appearance_date}{appearance.day_label ? ` · ${appearance.day_label}` : ''}</p>
                    {timeLabel && <p className="flex items-center gap-1.5"><Clock3 size={13} aria-hidden="true" />{timeLabel}</p>}
                    {(appearance.zone || appearance.booth) && <p className="flex items-center gap-1.5"><MapPin size={13} aria-hidden="true" />{[appearance.zone, appearance.booth].filter(Boolean).join(' · ')}</p>}
                  </div>
                  <div className="mt-2 flex gap-1">
                    <button type="button" onClick={() => openEdit(appearance)} className="icon-touch inline-flex items-center justify-center rounded-lg text-gray-500 hover:bg-white hover:text-fuchsia-700" aria-label={`Edit ${appearance.character_name}`}><Pencil size={15} /></button>
                    <button type="button" disabled={deletingId === appearance.id} onClick={() => void handleDelete(appearance)} className="icon-touch inline-flex items-center justify-center rounded-lg text-gray-500 hover:bg-red-50 hover:text-red-600 disabled:opacity-50" aria-label={`Remove ${appearance.character_name}`}><Trash2 size={15} /></button>
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      )}

      {draft && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/45 p-4 backdrop-blur-sm">
          <div role="dialog" aria-modal="true" aria-labelledby="appearance-form-title" ref={dialogRef} className="flex max-h-[92vh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl">
            <div className="flex items-center justify-between border-b border-gray-100 bg-gray-50 px-5 py-4">
              <div>
                <p className="text-xs font-black uppercase tracking-wide text-fuchsia-600">{editing ? 'Edit' : 'New'} Cosplan</p>
                <h3 id="appearance-form-title" className="text-lg font-black text-gray-900">Event appearance</h3>
              </div>
              <button type="button" onClick={closeForm} className="icon-touch inline-flex items-center justify-center rounded-lg text-gray-600 hover:bg-gray-100" aria-label="Close appearance form"><X size={20} /></button>
            </div>

            <div className="space-y-4 overflow-y-auto p-5 text-sm">
              {formError && <div role="alert" className="rounded-lg border border-red-100 bg-red-50 px-3 py-2 font-bold text-red-700">{formError}</div>}

              <div className="grid gap-4 sm:grid-cols-[140px_minmax(0,1fr)]">
                <div>
                  <div className="aspect-[4/5] overflow-hidden rounded-xl border border-gray-200 bg-fuchsia-50">
                    {imagePreview || draft.image_url ? (
                      <img src={imagePreview || getMenuImageUrl(draft.image_url)} alt="Appearance preview" className="h-full w-full object-cover" />
                    ) : (
                      <div className="flex h-full flex-col items-center justify-center gap-2 text-center text-fuchsia-300"><ImagePlus size={28} /><span className="text-xs font-bold">Optional image</span></div>
                    )}
                  </div>
                  <input ref={imageInputRef} type="file" accept="image/*" onChange={handleImageChange} className="sr-only" id="appearance-image" />
                  <button type="button" onClick={() => imageInputRef.current?.click()} className="mt-2 min-h-11 w-full rounded-lg border border-gray-200 bg-white px-3 text-xs font-black text-gray-700 hover:bg-gray-50">Choose image</button>
                  {(imagePreview || draft.image_url) && <button type="button" onClick={() => { setImageFile(null); updateDraft('image_url', ''); if (imageInputRef.current) imageInputRef.current.value = ''; }} className="mt-1 min-h-10 w-full text-xs font-bold text-red-600">Remove image</button>}
                </div>

                <div className="space-y-4">
                  <label className="block space-y-1">
                    <span className="text-xs font-bold uppercase text-gray-600">Character / look *</span>
                    <input value={draft.character_name} onChange={(e) => updateDraft('character_name', e.target.value)} maxLength={120} className="min-h-11 w-full rounded-lg border border-gray-200 px-3 outline-none focus:border-fuchsia-500" placeholder="e.g. Frieren" autoFocus />
                  </label>
                  <label className="block space-y-1">
                    <span className="text-xs font-bold uppercase text-gray-600">Series</span>
                    <input value={draft.series_name} onChange={(e) => updateDraft('series_name', e.target.value)} maxLength={160} className="min-h-11 w-full rounded-lg border border-gray-200 px-3 outline-none focus:border-fuchsia-500" placeholder="e.g. Frieren: Beyond Journey's End" />
                  </label>
                  <label className="flex min-h-11 items-center justify-between gap-3 rounded-lg border border-gray-200 px-3 py-2">
                    <span><span className="block text-sm font-black text-gray-800">Show publicly</span><span className="block text-xs font-semibold text-gray-500">Visitors can see this on your event card.</span></span>
                    <input type="checkbox" checked={draft.is_public} onChange={(e) => updateDraft('is_public', e.target.checked)} className="h-5 w-5 accent-fuchsia-600" />
                  </label>
                </div>
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <label className="block space-y-1">
                  <span className="text-xs font-bold uppercase text-gray-600">Date *</span>
                  <input type="date" value={draft.appearance_date} min={dateRange.min} max={dateRange.max} onChange={(e) => updateDraft('appearance_date', e.target.value)} className="min-h-11 w-full rounded-lg border border-gray-200 px-3 outline-none focus:border-fuchsia-500" />
                </label>
                <label className="block space-y-1">
                  <span className="text-xs font-bold uppercase text-gray-600">Day label</span>
                  <input value={draft.day_label} onChange={(e) => updateDraft('day_label', e.target.value)} maxLength={40} className="min-h-11 w-full rounded-lg border border-gray-200 px-3 outline-none focus:border-fuchsia-500" placeholder="e.g. Day 2" />
                </label>
                <label className="block space-y-1">
                  <span className="text-xs font-bold uppercase text-gray-600">From</span>
                  <input type="time" value={draft.start_time} onChange={(e) => updateDraft('start_time', e.target.value)} className="min-h-11 w-full rounded-lg border border-gray-200 px-3 outline-none focus:border-fuchsia-500" />
                </label>
                <label className="block space-y-1">
                  <span className="text-xs font-bold uppercase text-gray-600">Until</span>
                  <input type="time" value={draft.end_time} onChange={(e) => updateDraft('end_time', e.target.value)} className="min-h-11 w-full rounded-lg border border-gray-200 px-3 outline-none focus:border-fuchsia-500" />
                </label>
                <label className="block space-y-1">
                  <span className="text-xs font-bold uppercase text-gray-600">Zone</span>
                  <input value={draft.zone} onChange={(e) => updateDraft('zone', e.target.value)} maxLength={120} className="min-h-11 w-full rounded-lg border border-gray-200 px-3 outline-none focus:border-fuchsia-500" placeholder="e.g. Creator Hall" />
                </label>
                <label className="block space-y-1">
                  <span className="text-xs font-bold uppercase text-gray-600">Booth</span>
                  <input value={draft.booth} onChange={(e) => updateDraft('booth', e.target.value)} maxLength={120} className="min-h-11 w-full rounded-lg border border-gray-200 px-3 outline-none focus:border-fuchsia-500" placeholder="e.g. A12" />
                </label>
              </div>

              <label className="block space-y-1">
                <span className="text-xs font-bold uppercase text-gray-600">Note</span>
                <textarea value={draft.note} onChange={(e) => updateDraft('note', e.target.value)} maxLength={1000} rows={3} className="w-full resize-none rounded-lg border border-gray-200 p-3 outline-none focus:border-fuchsia-500" placeholder="Meet-up note, costume change, or availability details" />
              </label>
            </div>

            <div className="flex justify-end gap-2 border-t border-gray-100 bg-gray-50 p-4">
              <button type="button" onClick={closeForm} className="workspace-action min-h-11 px-4 text-sm font-black text-gray-700 hover:bg-gray-100">Cancel</button>
              <button type="button" onClick={() => void handleSave()} disabled={saving} className="workspace-action min-h-11 bg-fuchsia-600 px-5 text-sm font-black text-white hover:bg-fuchsia-700 disabled:opacity-60">{saving ? 'Saving...' : editing ? 'Save changes' : 'Add appearance'}</button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
};

export default EventAppearanceManager;
