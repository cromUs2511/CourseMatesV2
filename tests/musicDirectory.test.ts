import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_MUSIC_DIRECTORY, isSpiderManTrack } from '../src/data/musicDirectory';

test('recognizes Spider-Man soundtrack songs and labels', () => {
  for (const track of [
    { title: 'Vindicated', artist: 'Dashboard Confessional' },
    { title: 'Gone, Gone, Gone', artist: 'Phillip Phillips' },
    { title: 'Sunflower (Spider-Man: Into the Spider-Verse)', artist: 'Post Malone, Swae Lee' },
    { title: 'Post Malone, Swae Lee - Sunflower', artist: 'Official Music Video' },
    { title: 'Am I Dreaming', artist: 'Metro Boomin' },
    { title: 'Loser', artist: 'Tame Impala' },
    { title: 'Oh Yeah', artist: 'Steve Lacy' },
    { title: 'Spider-Man Theme', artist: 'Michael Bublé' },
  ]) assert.equal(isSpiderManTrack(track), true, track.title);
});

test('leaves unrelated music on the standard ambient effect', () => {
  assert.equal(isSpiderManTrack({ title: 'Coffee Shop Radio', artist: 'Chillhop Music' }), false);
  assert.equal(isSpiderManTrack({ title: 'Gone', artist: 'Charli XCX' }), false);
  assert.equal(isSpiderManTrack({ title: 'Home', artist: 'Edward Sharpe & The Magnetic Zeros' }), false);
});

test('offers the selected Brand New Day room-theme tracks in the music menu', () => {
  const selectedTracks = DEFAULT_MUSIC_DIRECTORY.filter(track =>
    (track.title === 'Loser' && track.artist === 'Tame Impala') ||
    (track.title === 'oh yeah?' && track.artist === 'Steve Lacy'),
  );
  assert.deepEqual(selectedTracks.map(track => track.youtubeVideoId), ['s3a4OQR-10M', 'yGHEis32s2Y']);
});
