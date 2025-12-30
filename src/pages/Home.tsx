import { Socials } from '../components/Socials';
import { EventSchedule } from '../components/EventSchedule';

const Home = () => {
  return (
    <div className="max-w-2xl mx-auto w-full px-4 py-8 sm:px-6 lg:px-8 space-y-8 animate-fade-in-down">
      <div className="text-center space-y-2">
        <h1 className="text-3xl sm:text-4xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-primary to-purple-600 dark:from-pink-400 dark:to-purple-400 pb-1">
          Genshin Impact Artist
        </h1>
        <div className="inline-flex items-center px-3 py-1 rounded-full bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400 text-sm font-medium">
          <span className="w-2 h-2 rounded-full bg-green-500 mr-2 animate-pulse"></span>
          Commissions Open
        </div>
      </div>

      <div className="space-y-6">
        <EventSchedule />
      </div>

      <Socials />
    </div>
  );
};

export default Home;
