import { useState } from "react";
import ConversationsList from "./ConversationsList";
import ChatWindow from "./ChatWindow";
import ChatInfoPanel from "./ChatInfoPanel";

export default function ChatPage() {
  const [activeChat, setActiveChat] = useState(null);

  return (
    <div className="flex h-[80vh] bg-gray-100 rounded-lg overflow-hidden">
      <div className="w-1/4 bg-white border-r">
        <ConversationsList onSelectChat={setActiveChat} />
      </div>

      <div className="w-1/2 bg-gray-50">
        {activeChat ? (
          <ChatWindow chat={activeChat} />
        ) : (
          <div className="h-full flex items-center justify-center text-gray-500">
            Select a conversation
          </div>
        )}
      </div>

      <div className="w-1/4 bg-white border-l">
        <ChatInfoPanel chat={activeChat} />
      </div>
    </div>
  );
}
