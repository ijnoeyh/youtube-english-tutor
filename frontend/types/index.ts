export interface Video {
  id: number;
  youtube_id: string;
  title: string;
  channel?: string | null;
  description?: string | null;
  thumbnail_url?: string | null;
  duration_sec?: number | null;
  segment_count: number;
  created_at: string;
}

export interface Segment {
  id: number;
  start_sec: number;
  end_sec: number;
  text: string;
}

export interface VideoDetail {
  video: Video;
  segments: Segment[];
}
