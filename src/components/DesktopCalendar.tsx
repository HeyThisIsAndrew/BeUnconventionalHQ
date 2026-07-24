import React, { useState, useMemo } from 'react';
import { parseEventDateToLocal, formatEventDateRange } from '../lib/events';
import './DesktopCalendar.css';

export interface CalendarEvent {
  title: string;
  startDate: string;
  endDate?: string;
  brandColor?: string;
  slug?: { current: string } | string;
}

export interface DesktopCalendarProps {
  events: CalendarEvent[];
}

interface CalendarSegment {
  id: string;
  row: number;
  colStart: number;
  colEnd: number;
  span: number;
  color: string;
  slug: string;
  title: string;
  isStart: boolean;
  isEnd: boolean;
  isContinuation: boolean;
  isPast: boolean;
  overlapIndex?: number;
}

const DesktopCalendar: React.FC<DesktopCalendarProps> = ({ events }) => {
  const [currentDate, setCurrentDate] = useState<Date | null>(null);
  const [hoveredEventId, setHoveredEventId] = useState<string | null>(null);

  React.useEffect(() => {
    setCurrentDate(new Date());
  }, []);

  // `year`/`month` and the useMemo below MUST be evaluated on every render,
  // above the `!currentDate` early return. `currentDate` starts null and is
  // only filled in by the effect above (deliberately — reading the date
  // during SSR would bake the server's timezone into the grid), so the first
  // render returns the skeleton early. When the useMemo lived BELOW that
  // return, render 1 ran three hooks and render 2 ran four, which is
  // "Rendered more hooks than during the previous render" (React #310). React
  // threw on the very first state update and unmounted the whole tree, so the
  // calendar modal opened to an empty shell with only its close bar — on
  // every device, in production. Keep all hooks above the early return.
  const year = currentDate ? currentDate.getFullYear() : 0;
  const month = currentDate ? currentDate.getMonth() : 0;

  const { days, calendarSegments, sortedEvents, todayDate } = useMemo(() => {
    // Pre-hydration render: no date yet, and the result is discarded by the
    // early return below. Bail rather than build a grid for year 0.
    if (!currentDate) {
      // todayDate stays a real Date rather than null so the consuming code
      // below (which only ever runs once currentDate is set) keeps its
      // non-nullable type; this value is never read.
      return { days: [], calendarSegments: [], sortedEvents: [], todayDate: new Date() };
    }

    const firstDay = new Date(year, month, 1);
    const lastDay = new Date(year, month + 1, 0);
    const monthStart = new Date(year, month, 1);
    const monthEnd = new Date(year, month + 1, 0, 23, 59, 59, 999);
    const startingDayOfWeek = firstDay.getDay(); // 0 (Sun) to 6 (Sat)
    const totalDays = lastDay.getDate();

    const _days = [];
    for (let i = 0; i < startingDayOfWeek; i++) {
      _days.push({ day: 0, empty: true });
    }
    for (let i = 1; i <= totalDays; i++) {
      _days.push({ day: i, empty: false });
    }

    const currentMonthEvents = events.filter((event) => {
      if (!event.startDate) return false;
      const start = parseEventDateToLocal(event.startDate);
      const end = parseEventDateToLocal(event.endDate || event.startDate);

      if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
        return false;
      }

      return start <= monthEnd && end >= monthStart;
    });

    const _sortedEvents = [...currentMonthEvents].sort((a, b) =>
      a.startDate.localeCompare(b.startDate)
    );

    const _todayDate = new Date();
    _todayDate.setHours(0, 0, 0, 0);

    const rawSegments = currentMonthEvents.flatMap((event) => {
      const start = parseEventDateToLocal(event.startDate);
      const end = event.endDate ? parseEventDateToLocal(event.endDate) : start;

      if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
        return [];
      }

      const isPast = end < _todayDate;
      const startDay = start < monthStart ? 1 : start.getDate();
      const endDay = end > monthEnd ? totalDays : end.getDate();

      const startIndex = startingDayOfWeek + startDay - 1;
      const endIndex = startingDayOfWeek + endDay - 1;

      const startRow = Math.floor(startIndex / 7) + 1;
      const startCol = (startIndex % 7) + 1;
      const endRow = Math.floor(endIndex / 7) + 1;
      const endCol = (endIndex % 7) + 1;

      const color = event.brandColor || 'var(--color-accent, #cc0000)';
      const segments: CalendarSegment[] = [];

      const slug = (typeof event.slug === 'object' && event.slug !== null) 
        ? event.slug.current 
        : (event.slug || '');

      for (let row = startRow; row <= endRow; row++) {
        const colStart = row === startRow ? startCol : 1;
        const colEnd = row === endRow ? endCol : 7;
        const span = colEnd - colStart + 1;
        const isStart = row === startRow;
        const isEnd = row === endRow;

        segments.push({
          id: `${slug}-${row}`,
          row,
          colStart,
          colEnd,
          span,
          color,
          slug,
          title: event.title,
          isStart,
          isEnd,
          isContinuation: !isStart,
          isPast,
        });
      }

      return segments;
    });

    const segmentsPerRow: Record<number, CalendarSegment[]> = {};
    rawSegments.forEach((segment) => {
      if (!segmentsPerRow[segment.row]) segmentsPerRow[segment.row] = [];
      
      let overlapIndex = 0;
      const rowSegments = segmentsPerRow[segment.row];
      
      while (
        rowSegments.some(
          (s) =>
            s.overlapIndex === overlapIndex &&
            !(segment.colEnd < s.colStart || segment.colStart > s.colEnd)
        )
      ) {
        overlapIndex++;
      }
      
      segment.overlapIndex = overlapIndex;
      rowSegments.push(segment);
    });

    return {
      days: _days,
      calendarSegments: rawSegments,
      sortedEvents: _sortedEvents,
      todayDate: _todayDate
    };
  }, [events, year, month, currentDate]);

  if (!currentDate) {
    return (
      <div className="dc-container dc-skeleton">
        <aside className="dc-sidebar">
          <div className="dc-sidebar-header">
            <div className="dc-sidebar-title">
              <h2 className="dc-month">Calendar</h2>
              <span className="dc-year">...</span>
            </div>
          </div>
          <div className="dc-event-list"></div>
        </aside>
        <main className="dc-main">
          <div className="dc-calendar-grid-wrapper">
            <div className="dc-calendar-header-row">
              <span>Sun</span>
              <span>Mon</span>
              <span>Tue</span>
              <span>Wed</span>
              <span>Thu</span>
              <span>Fri</span>
              <span>Sat</span>
            </div>
            <div className="dc-calendar-grid">
              {Array.from({ length: 35 }).map((_, i) => (
                <div
                  key={`skel-${i}`}
                  className="dc-calendar-cell empty"
                  style={{ gridColumn: (i % 7) + 1, gridRow: Math.floor(i / 7) + 1 }}
                ></div>
              ))}
            </div>
          </div>
        </main>
      </div>
    );
  }
  
  const handlePrevMonth = () => {
    setCurrentDate(new Date(year, month - 1, 1));
  };

  const handleNextMonth = () => {
    setCurrentDate(new Date(year, month + 1, 1));
  };

  const realToday = new Date();
  const isCurrentOrPastMonth = year < realToday.getFullYear() || (year === realToday.getFullYear() && month <= realToday.getMonth());



  const formatDate = (dateStr: string) => formatEventDateRange(dateStr, undefined, { year: false });

  // Add global style variables via style prop to circumvent styled-jsx/astro scoping for inline styles
  return (
    <div className="dc-container">
      <aside className="dc-sidebar">
        <div className="dc-sidebar-header">
          <div className="dc-sidebar-title">
            <h2 className="dc-month">
              {currentDate.toLocaleString('en-US', { month: 'short' })}
            </h2>
            <span className="dc-year">{currentDate.getFullYear()}</span>
          </div>
          <div className="dc-nav-buttons">
            <button 
              className={`dc-nav-btn ${isCurrentOrPastMonth ? 'disabled' : ''}`} 
              onClick={handlePrevMonth} 
              disabled={isCurrentOrPastMonth}
              aria-label="Previous Month"
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M15 18l-6-6 6-6" />
              </svg>
            </button>
            <button className="dc-nav-btn" onClick={handleNextMonth} aria-label="Next Month">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M9 18l6-6-6-6" />
              </svg>
            </button>
          </div>
        </div>

        <div className="dc-event-list">
          {sortedEvents.map((event) => {
            const eventEnd = parseEventDateToLocal(event.endDate || event.startDate);
            const isPast = eventEnd < todayDate;
            const slugStr = (typeof event.slug === 'object' && event.slug !== null) ? event.slug.current : (event.slug || '');
            
            return (
              <a
                key={slugStr}
                href={isPast ? undefined : `/events/${slugStr}`}
                className={`dc-event-item ${isPast ? 'is-past' : ''}`}
                data-event-id={slugStr}
                onMouseEnter={() => setHoveredEventId(slugStr)}
                onMouseLeave={() => setHoveredEventId(null)}
              >
                <div
                  className="dc-event-indicator"
                  style={{ backgroundColor: event.brandColor || 'var(--color-accent)' }}
                ></div>
                <div className="dc-event-content">
                  <h3 className="dc-event-title">{event.title}</h3>
                  <p className="dc-event-date">
                    {formatDate(event.startDate)}
                    {event.endDate &&
                      event.endDate !== event.startDate &&
                      ` - ${formatDate(event.endDate)}`}
                  </p>
                </div>
              </a>
            );
          })}
          {sortedEvents.length === 0 && <p className="dc-no-events">No events this month.</p>}
        </div>
      </aside>

      <main className="dc-main">
        <div className="dc-calendar-grid-wrapper">
          <div className="dc-calendar-header-row">
            <span>Sun</span>
            <span>Mon</span>
            <span>Tue</span>
            <span>Wed</span>
            <span>Thu</span>
            <span>Fri</span>
            <span>Sat</span>
          </div>

          <div className="dc-calendar-grid">
            {days.map((d, i) => (
              <div
                key={`day-${i}`}
                className={`dc-calendar-cell ${d.empty ? 'empty' : ''}`}
                style={{
                  gridColumn: (i % 7) + 1,
                  gridRow: Math.floor(i / 7) + 1,
                }}
              >
                {!d.empty && <span className="dc-day-number">{d.day}</span>}
              </div>
            ))}

            {calendarSegments.map((segment) => {
              const isHovered = hoveredEventId === segment.slug;
              const Element = segment.isPast ? 'div' : 'a';
              return (
                <Element
                  key={segment.id}
                  href={segment.isPast ? undefined : `/events/${segment.slug}`}
                  data-event-id={segment.slug}
                  className={`dc-highlighter-bar ${segment.isStart ? 'is-start' : ''} ${
                    segment.isEnd ? 'is-end' : ''
                  } ${segment.isContinuation ? 'is-continuation' : ''} ${
                    segment.isPast ? 'is-past' : ''
                  } ${isHovered ? 'hover-active' : ''}`}
                  style={{
                    gridRow: segment.row,
                    gridColumn: `${segment.colStart} / span ${segment.span}`,
                    '--bar-color': segment.color,
                    '--overlap-index': segment.overlapIndex,
                  } as React.CSSProperties}
                  onMouseEnter={() => setHoveredEventId(segment.slug)}
                  onMouseLeave={() => setHoveredEventId(null)}
                >
                  {segment.isContinuation && (
                    <span className="dc-bar-cont" aria-hidden="true">
                      ↳{' '}
                    </span>
                  )}
                  <span className="dc-bar-label">{segment.title}</span>
                </Element>
              );
            })}
          </div>
        </div>
      </main>
    </div>
  );
};

export default DesktopCalendar;
