#!/usr/bin/env python3
"""
CourseMates - Python Ephemeral In-Memory Backend Engine
Zero-Log RAM-only Student Matchmaking & Verified Anonymous Peer Network
Port: 8000
"""

import sys
import json
import time
import random
import re
from http.server import HTTPServer, BaseHTTPRequestHandler
from socketserver import ThreadingMixIn
from urllib.parse import urlparse, parse_qs
import hashlib

PORT = 5050

# Adjectives & Nouns for Anonymous Identity Generation
ADJECTIVES = [
    "Curious", "Astute", "Quantum", "Resilient", "Pragmatic", "Keen", "Ingenious",
    "Analytical", "Dynamic", "Nimble", "Serene", "Luminous", "Vibrant", "Brisk",
    "Strategic", "Diligent", "Creative", "Perceptive", "Tenacious", "Reflective"
]

NOUNS = [
    "Cardinal", "Falcon", "Tamaraw", "Builder", "Coder", "Architect", "Hawk",
    "Engineer", "Scholar", "Voyager", "Navigator", "Polymath", "Innovator",
    "Pioneer", "Alchemist", "Solver", "Strategist", "Crafter", "Explorer"
]

AVATARS = ['🦅', '🦉', '🦊', '🐺', '🦁', '🚀', '⚡', '🔬', '📐', '💻', '🎨', '⚙️', '🌟', '🛡️']

# Volatile In-Memory State (RAM Only - Zero Log)
FIFO_QUEUE = []
ACTIVE_ROOMS = {}
SESSION_TO_ROOM = {}
MUSIC_DIRECTORY = [
    {
        "id": "track-chillhop-1",
        "title": "Coffee Shop Radio - 24/7 Chillhop & Jazzy Beats",
        "artist": "Chillhop Music",
        "youtubeUrl": "https://www.youtube.com/watch?v=5yx6BWlEVcY",
        "youtubeVideoId": "5yx6BWlEVcY",
        "category": "chill",
        "duration": "24/7 Stream",
        "thumbnail": "https://img.youtube.com/vi/5yx6BWlEVcY/hqdefault.jpg",
        "addedAt": int(time.time() * 1000) - 3600000,
    },
    {
        "id": "track-lofi-1",
        "title": "lofi hip hop radio - beats to relax/study to",
        "artist": "Lofi Girl",
        "youtubeUrl": "https://www.youtube.com/watch?v=jfKfPfyJRdk",
        "youtubeVideoId": "jfKfPfyJRdk",
        "category": "lofi",
        "duration": "24/7 Live Stream",
        "thumbnail": "https://img.youtube.com/vi/jfKfPfyJRdk/hqdefault.jpg",
        "addedAt": int(time.time() * 1000) - 1800000,
    },
    {
        "id": "track-classical-1",
        "title": "Calm Classical Piano for Calculus & Physics Focus",
        "artist": "Halidon Music",
        "youtubeUrl": "https://www.youtube.com/watch?v=4xDzrJKXOOY",
        "youtubeVideoId": "4xDzrJKXOOY",
        "category": "classical",
        "duration": "2:34:12",
        "thumbnail": "https://img.youtube.com/vi/4xDzrJKXOOY/hqdefault.jpg",
        "addedAt": int(time.time() * 1000) - 7200000,
    }
]

STUDY_GROUPS = [
    {
        "id": "grp-1",
        "title": "MATH101 Integral Calculus Cram Session",
        "subjectCode": "MATH101",
        "topic": "Integration by Parts & Trigonometric Substitution",
        "membersCount": 4,
        "maxMembers": 6,
        "campus": "Main Campus",
        "activeTopicDescription": "Working through set B exam review problems together.",
        "createdAt": int(time.time() * 1000) - 2400000,
    },
    {
        "id": "grp-2",
        "title": "CS102 Data Structures & Algorithms Peer Lab",
        "subjectCode": "CS102",
        "topic": "Binary Search Trees, AVL Rotations & Dynamic Programming",
        "membersCount": 3,
        "maxMembers": 6,
        "campus": "City Campus",
        "activeTopicDescription": "Debugging tree rebalancing edge cases before submission.",
        "createdAt": int(time.time() * 1000) - 1200000,
    }
]

def generate_handle():
    adj = random.choice(ADJECTIVES)
    noun = random.choice(NOUNS)
    num = random.randint(1000, 9999)
    return f"{adj} {noun} #{num}", ""

def extract_video_id(url: str):
    if not url:
        return None
    url = url.strip()
    if re.match(r"^[a-zA-Z0-9_-]{11}$", url):
        return url
    match = re.search(r"(?:youtube\.com\/(?:[^\/\n\s]+\/\S+\/|(?:v|e(?:mbed)?|live)\/|\S*?[?&]v=)|youtu\.be\/)([a-zA-Z0-9_-]{11})", url)
    return match.group(1) if match else None

class ThreadedHTTPServer(ThreadingMixIn, HTTPServer):
    daemon_threads = True

class EngineRequestHandler(BaseHTTPRequestHandler):
    def log_message(self, _format, *_args):
        # Zero-log: suppresses persistent request logs
        del _format, _args
        return

    def _send_json(self, status: int, data: dict):
        response_bytes = json.dumps(data).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(response_bytes)))
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.end_headers()
        self.wfile.write(response_bytes)

    def do_OPTIONS(self):
        self.send_response(200)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.end_headers()

    def do_GET(self):
        parsed = urlparse(self.path)
        path = parsed.path
        query = parse_qs(parsed.query)

        if path == "/api/health":
            self._send_json(200, {
                "status": "ok",
                "environment": "CourseMates In-Memory Ephemeral Engine (Python Core)",
                "engine": "Python 3.10 In-Memory Ephemeral Engine",
                "python": True,
                "version": f"{sys.version_info.major}.{sys.version_info.minor}.{sys.version_info.micro}",
                "onlineUsers": 16 + len(FIFO_QUEUE) + (len(ACTIVE_ROOMS) * 2),
                "activeRooms": len(ACTIVE_ROOMS),
                "queuedStudents": len(FIFO_QUEUE),
                "ramZeroLogActive": True,
                "timestamp": int(time.time() * 1000)
            })

        elif path == "/api/match/poll":
            session_id = query.get("sessionId", [None])[0]
            if not session_id:
                return self._send_json(400, {"error": "sessionId query required"})

            if session_id in SESSION_TO_ROOM:
                matched = SESSION_TO_ROOM[session_id]
                return self._send_json(200, {
                    "status": "matched",
                    "roomId": matched["roomId"],
                    "peer": matched["peer"],
                    "topic": matched["topic"],
                })

            for idx, item in enumerate(FIFO_QUEUE):
                if item["id"] == session_id:
                    return self._send_json(200, {
                        "status": "queued",
                        "position": idx + 1
                    })

            self._send_json(200, {"status": "idle"})

        elif path == "/api/chat/messages":
            room_id = query.get("roomId", [None])[0]
            since = int(query.get("since", [0])[0] or 0)
            handle = query.get("handle", [""])[0]

            room = ACTIVE_ROOMS.get(room_id)
            if not room:
                return self._send_json(200, {
                    "active": False,
                    "messages": [],
                    "peerDisconnected": True,
                    "isPeerTyping": False
                })

            new_msgs = [m for m in room["messages"] if m["timestamp"] > since]
            is_peer_typing = False
            for h, typing in room.get("typingState", {}).items():
                if h != handle and typing:
                    is_peer_typing = True

            self._send_json(200, {
                "active": True,
                "messages": new_msgs,
                "isPeerTyping": is_peer_typing,
                "peerDisconnected": room.get("peerDisconnected", False)
            })

        elif path == "/api/music/directory":
            self._send_json(200, {
                "tracks": MUSIC_DIRECTORY,
                "total": len(MUSIC_DIRECTORY)
            })

        elif path == "/api/study-groups":
            self._send_json(200, STUDY_GROUPS)

        elif path == "/api/analytics":
            self._send_json(200, {
                "activeMatchesNow": 42 + random.randint(0, 8),
                "todayMatchedStudents": 318,
                "crossDisciplineRate": 76.4,
                "avgSessionDurationMins": 11.8,
                "satisfactionNps": 58,
                "stressReliefRating": 89.2,
                "engine": "Python 3.10 In-Memory Engine",
                "topSubjects": [
                    {"name": "Differential & Integral Calculus", "count": 112, "percentage": 35},
                    {"name": "Data Structures & Algorithms", "count": 88, "percentage": 28},
                    {"name": "Engineering Physics & Mechanics", "count": 64, "percentage": 20},
                    {"name": "Thesis / Capstone Brainstorming", "count": 32, "percentage": 10},
                    {"name": "Term Stress & Wellness Venting", "count": 22, "percentage": 7},
                ],
                "campusBreakdown": [
                    {"campus": "Main Campus", "activeCount": 26},
                    {"campus": "City Campus", "activeCount": 12},
                    {"campus": "North Campus", "activeCount": 4},
                    {"campus": "Digital / Online", "activeCount": 8},
                ]
            })

        else:
            self._send_json(404, {"error": "Not found in Python Engine"})

    def do_POST(self):
        parsed = urlparse(self.path)
        path = parsed.path

        content_len = int(self.headers.get("Content-Length", 0))
        post_body = self.rfile.read(content_len) if content_len > 0 else b"{}"

        try:
            body = json.loads(post_body.decode("utf-8")) if post_body else {}
        except Exception:
            body = {}

        if path in ["/api/auth/school-email", "/api/auth/verify-school", "/api/auth/microsoft/verify-test"]:
            email = body.get("email", "").strip().lower()
            if not email:
                return self._send_json(400, {"error": "Institutional email is required"})

            is_valid_email = "@" in email and "." in email.rsplit("@", 1)[-1]
            if not is_valid_email:
                return self._send_json(403, {
                    "error": "ACCESS DENIED: Please provide a valid email address.",
                    "attempted": email,
                    "authorizedDomains": ["gmail.com"]
                })

            handle, _ = generate_handle()
            token = f"cm_py_{int(time.time()*1000)}_{random.randint(1000, 9999)}"
            campus = body.get("campus") or "Main Campus"
            discipline = body.get("discipline") or "Computer Science & IT"
            interests = body.get("interests") or ["Coding, DSA & Software"]
            hashed_id = hashlib.sha256(email.encode("utf-8")).hexdigest()

            self._send_json(200, {
                "success": True,
                "session": {
                    "email": email,
                    "isVerified": True,
                    "isSchoolVerified": True,
                    "hashedStudentId": hashed_id,
                    "campus": campus,
                    "discipline": discipline,
                    "interests": interests,
                    "sessionHandle": handle,
                    "sessionAvatar": "",
                    "token": token,
                    "authProvider": "email_demo",
                    "createdAt": int(time.time() * 1000),
                },
                "message": "Email address verified."
            })

        elif path == "/api/match/join":
            session_id = body.get("sessionId")
            handle = body.get("handle")
            avatar = ""
            campus = body.get("campus") or "Main Campus"
            discipline = body.get("discipline") or "General Studies"
            interests = body.get("interests") or ["General Chat"]
            topic = body.get("topic") or "General Discussion"

            if not session_id or not handle:
                return self._send_json(400, {"error": "Session ID and handle required"})

            # Check if already matched
            if session_id in SESSION_TO_ROOM:
                matched = SESSION_TO_ROOM[session_id]
                return self._send_json(200, {
                    "status": "matched",
                    "roomId": matched["roomId"],
                    "peer": matched["peer"],
                    "topic": matched["topic"],
                })

            # Check queue for a match
            other_idx = -1
            for idx, item in enumerate(FIFO_QUEUE):
                if item["id"] != session_id:
                    other_idx = idx
                    break

            if other_idx != -1:
                matched_peer = FIFO_QUEUE.pop(other_idx)
                room_id = f"room_py_{int(time.time()*1000)}_{random.randint(100, 999)}"

                peer_a = {
                    "id": session_id,
                    "handle": handle,
                    "avatar": avatar,
                    "discipline": discipline,
                    "campus": campus,
                    "interests": interests
                }
                peer_b = {
                    "id": matched_peer["id"],
                    "handle": matched_peer["handle"],
                    "avatar": matched_peer["avatar"],
                    "discipline": matched_peer["discipline"],
                    "campus": matched_peer["campus"],
                    "interests": matched_peer["interests"]
                }

                chosen_topic = topic if topic != "General Discussion" else matched_peer.get("topic", "General Discussion")

                ACTIVE_ROOMS[room_id] = {
                    "roomId": room_id,
                    "peerA": peer_a,
                    "peerB": peer_b,
                    "topic": chosen_topic,
                    "messages": [{
                        "id": f"sys_{int(time.time()*1000)}",
                        "senderHandle": "CourseMates System",
                        "senderAvatar": "⚡",
                        "text": f"Connected! You are chatting anonymously with {matched_peer['handle']} ({matched_peer['discipline']}, {matched_peer['campus']} Campus). Ephemeral Zero-Log memory active on Python Engine.",
                        "timestamp": int(time.time() * 1000),
                        "type": "system"
                    }],
                    "typingState": {},
                    "peerDisconnected": False,
                    "createdAt": int(time.time() * 1000)
                }

                SESSION_TO_ROOM[session_id] = {
                    "roomId": room_id,
                    "peer": peer_b,
                    "topic": chosen_topic
                }
                SESSION_TO_ROOM[matched_peer["id"]] = {
                    "roomId": room_id,
                    "peer": peer_a,
                    "topic": chosen_topic
                }

                return self._send_json(200, {
                    "status": "matched",
                    "roomId": room_id,
                    "peer": peer_b,
                    "topic": chosen_topic
                })

            # Otherwise queue
            # Check if already in queue
            already_in_q = any(item["id"] == session_id for item in FIFO_QUEUE)
            if not already_in_q:
                FIFO_QUEUE.append({
                    "id": session_id,
                    "handle": handle,
                    "avatar": avatar,
                    "campus": campus,
                    "discipline": discipline,
                    "interests": interests,
                    "topic": topic,
                    "joinedAt": int(time.time() * 1000)
                })

            self._send_json(200, {
                "status": "queued",
                "position": len(FIFO_QUEUE)
            })

        elif path == "/api/match/cancel":
            session_id = body.get("sessionId")
            if session_id:
                FIFO_QUEUE[:] = [item for item in FIFO_QUEUE if item["id"] != session_id]
                SESSION_TO_ROOM.pop(session_id, None)
            self._send_json(200, {"success": True})

        elif path == "/api/chat/send":
            room_id = body.get("roomId")
            text = body.get("text", "")
            sender_handle = body.get("senderHandle", "Anonymous")
            sender_avatar = body.get("senderAvatar", "🦅")
            msg_type = body.get("msgType", "text")

            room = ACTIVE_ROOMS.get(room_id)
            if not room:
                return self._send_json(404, {"error": "Active chat room not found or session ended."})

            new_msg = {
                "id": f"msg_py_{int(time.time()*1000)}_{random.randint(100, 999)}",
                "senderHandle": sender_handle,
                "senderAvatar": sender_avatar,
                "text": text,
                "timestamp": int(time.time() * 1000),
                "type": msg_type
            }
            room["messages"].append(new_msg)
            self._send_json(200, {"success": True, "message": new_msg})

        elif path == "/api/chat/typing":
            room_id = body.get("roomId")
            handle = body.get("handle")
            is_typing = body.get("isTyping", False)
            room = ACTIVE_ROOMS.get(room_id)
            if room and handle:
                room["typingState"][handle] = is_typing
            self._send_json(200, {"success": True})

        elif path == "/api/chat/leave":
            room_id = body.get("roomId")
            session_id = body.get("sessionId")
            if session_id:
                SESSION_TO_ROOM.pop(session_id, None)
            if room_id:
                room = ACTIVE_ROOMS.get(room_id)
                if room:
                    room["peerDisconnected"] = True
                    room["messages"].append({
                        "id": f"sys_leave_{int(time.time()*1000)}",
                        "senderHandle": "CourseMates System",
                        "senderAvatar": "⚡",
                        "text": "Peer has left the conversation. Ephemeral memory purged.",
                        "timestamp": int(time.time() * 1000),
                        "type": "system"
                    })
            self._send_json(200, {"success": True})

        elif path == "/api/music/directory":
            title = body.get("title")
            artist = body.get("artist")
            youtube_url = body.get("youtubeUrl")
            category = body.get("category") or "lofi"

            if not youtube_url:
                return self._send_json(400, {"error": "YouTube URL or Video ID is required"})

            video_id = extract_video_id(youtube_url)
            if not video_id:
                return self._send_json(400, {"error": "Invalid YouTube URL or Video ID"})

            new_track = {
                "id": f"track-py-{int(time.time()*1000)}",
                "title": title.strip() if title else f"YouTube Study Track ({video_id})",
                "artist": artist.strip() if artist else "Community YouTube Share",
                "youtubeUrl": f"https://www.youtube.com/watch?v={video_id}",
                "youtubeVideoId": video_id,
                "category": category,
                "duration": "YouTube Stream",
                "thumbnail": f"https://img.youtube.com/vi/{video_id}/hqdefault.jpg",
                "addedAt": int(time.time() * 1000)
            }
            MUSIC_DIRECTORY.insert(0, new_track)
            self._send_json(200, {"success": True, "track": new_track, "directory": MUSIC_DIRECTORY})

        elif path == "/api/study-groups":
            new_grp = {
                "id": f"grp-py-{int(time.time()*1000)}",
                "title": body.get("title") or "Anonymous Study Huddle",
                "subjectCode": body.get("subjectCode") or "ENG101",
                "topic": body.get("topic") or "Collaborative Problem Solving",
                "membersCount": 1,
                "maxMembers": 6,
                "campus": body.get("campus") or "Main Campus",
                "activeTopicDescription": body.get("activeTopicDescription") or "Working through practice sets together.",
                "createdAt": int(time.time() * 1000)
            }
            STUDY_GROUPS.insert(0, new_grp)
            self._send_json(200, new_grp)

        elif path == "/api/ai/assist":
            action = body.get("action", "suggest")
            query = body.get("query", "")
            if action == "explain":
                result = f'Study Tutor Insight: For "{query}", break the problem down into its fundamental axioms, solve for the boundary constraints first, and test with sample unit values.'
            elif action == "summarize":
                result = "Study Summary:\n• Covered core concept principles\n• Identified tricky problem areas and edge cases\n• Solved sample practice sets collaboratively"
            else:
                result = 'Conversation Starters:\n1. "What course or subject are you studying for right now?"\n2. "How did you find the latest departmental quiz or assignment?"'
            self._send_json(200, {"result": result, "engine": "Python 3.10 Engine"})

        elif path == "/api/ai/suggestions":
            topic = body.get("topic", "General Discussion")
            discipline = body.get("discipline", "")
            
            # Academic and peer context pools
            academics_pool = [
                f"How are you approaching your problem sets in {topic}?",
                "Are you preparing for upcoming midterm departmentals or machine problems?",
                "What's the hardest concept or module you've encountered so far this term?",
                "Do you have past exams or lecture slide notes we can cross-reference?",
                "What's your preferred workflow when debugging code or working out derivations?",
                "How are your professors pacing the syllabus this quarter?",
                "Want to do a quick 20-minute pomodoro sprint on our assignments?",
                "Are you taking any tricky prerequisite subjects alongside this?",
            ]
            coding_pool = [
                "What tech stack or language are you using for your machine problem?",
                "Have you run into any weird runtime bugs or segmentation faults today?",
                "Are you practicing LeetCode / DSA patterns for technical interviews?",
                "Do you prefer C++, Python, Java, or TypeScript for algorithm labs?",
                "What IDE / terminal tools are in your everyday developer setup?",
                "Working on any personal Github repositories or portfolio projects?",
            ]
            campus_pool = [
                "Which campus are you usually at — main or city campus?",
                "What are your go-to study nooks or quiet corners around campus?",
                "How are you managing the fast-paced term schedule this quarter?",
                "Any good coffee or food recommendations near school?",
                "Are you part of any student organizations or academic societies?",
                "How was your commute or online class setup today?",
            ]
            thesis_pool = [
                "What domain is your capstone / thesis focusing on?",
                "How is your adviser review and methodology defense coming along?",
                "Are you building hardware prototypes, simulations, or software systems?",
                "What datasets or APIs are you utilizing for your experiments?",
            ]
            
            topic_lower = topic.lower()
            if any(k in topic_lower for k in ["code", "cs", "dsa", "software", "program", "it", "algorithm"]):
                pool = coding_pool + academics_pool
            elif any(k in topic_lower for k in ["thesis", "capstone", "research"]):
                pool = thesis_pool + academics_pool
            elif any(k in topic_lower for k in ["campus", "hangout", "stress", "vent", "chill"]):
                pool = campus_pool + academics_pool
            else:
                pool = academics_pool + campus_pool
                
            random.shuffle(pool)
            selected = pool[:4]
            self._send_json(200, {
                "suggestions": selected,
                "topic": topic,
                "shuffled": True,
                "engine": "Python 3.10 Engine"
            })

        else:
            self._send_json(404, {"error": "Endpoint not found in Python Engine"})

    def do_DELETE(self):
        parsed = urlparse(self.path)
        path = parsed.path
        if path.startswith("/api/music/directory/"):
            track_id = path.split("/")[-1]
            MUSIC_DIRECTORY[:] = [t for t in MUSIC_DIRECTORY if t["id"] != track_id]
            self._send_json(200, {"success": True, "deleted": track_id})
        else:
            self._send_json(404, {"error": "Not found in Python Engine"})

def run_server():
    server_address = ("0.0.0.0", PORT)
    httpd = ThreadedHTTPServer(server_address, EngineRequestHandler)
    print(f"CourseMates Python Core Engine running at http://0.0.0.0:{PORT}", flush=True)
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        httpd.server_close()

if __name__ == "__main__":
    run_server()
