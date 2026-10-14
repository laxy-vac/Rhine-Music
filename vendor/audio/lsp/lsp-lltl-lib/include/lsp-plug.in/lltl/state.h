/*
 * Copyright (C) 2025 Linux Studio Plugins Project <https://lsp-plug.in/>
 *           (C) 2025 Vladimir Sadovnikov <sadko4u@gmail.com>
 *
 * This file is part of lsp-lltl-lib
 * Created on: 19 июн. 2024 г.
 *
 * lsp-lltl-lib is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Lesser General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * any later version.
 *
 * lsp-lltl-lib is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU Lesser General Public License for more details.
 *
 * You should have received a copy of the GNU Lesser General Public License
 * along with lsp-lltl-lib. If not, see <https://www.gnu.org/licenses/>.
 */

#ifndef LSP_PLUG_IN_LLTL_STATE_H_
#define LSP_PLUG_IN_LLTL_STATE_H_

#include <lsp-plug.in/lltl/version.h>
#include <lsp-plug.in/lltl/types.h>

namespace lsp
{
    namespace lltl
    {
        struct LSP_LLTL_LIB_PUBLIC raw_state
        {
            public:
                typedef void    (* deleter1_t)(void *ptr);
                typedef void    (* deleter2_t)(void *ptr, void *arg);

            private:
                enum bin_t
                {
                    B_PENDING,
                    B_STATE,
                    B_GARBAGE,

                    B_TOTAL
                };

            private:
                void           *bins[B_TOTAL];
                deleter2_t      deleter2;
                union
                {
                    deleter1_t      deleter1;
                    void           *params;
                };

            private:
                void            cleanup(void *garbage);
                void            init_bins();

            public:
                void            init();
                void            init(deleter1_t deleter);
                void            init(deleter2_t deleter, void *arg);
                void            set_deleter(deleter1_t deleter);
                void            set_deleter(deleter2_t deleter, void *arg);
                void            clear();
                void            destroy();
                void            push(void *new_state);
                bool            set(void *new_state);
                void           *pull();
                void           *get();
                bool            pending() const;
                void           *current() const;
                void            gc();
        };


        /**
         * State with lock-free update mechanism
         */
        template <class T>
        class state
        {
            public:
                using deleter1_t    = void (*)(T *ptr);
                template <class V>
                using deleter2_t    = void (*)(T *ptr, V *arg);

            private:
                raw_state       v;

            private:
                inline static T *tcast(void *ptr)       { return static_cast<T *>(ptr); }

            public:
                inline state()                          { v.init(); }

                explicit inline state(deleter1_t deleter)
                {
                    v.init(reinterpret_cast<raw_state::deleter1_t>(deleter));
                }

                template <class V>
                explicit inline state(deleter2_t<V> deleter, V *arg)
                {
                    v.init(reinterpret_cast<raw_state::deleter2_t>(deleter), arg);
                }

                state(const state &) = delete;
                state(state &&) = delete;
                inline ~state()                         { v.destroy(); }

                state & operator = (const state &) = delete;
                state & operator = (state &&) = delete;

                inline void set_deleter(deleter1_t deleter)
                {
                    v.set_deleter(reinterpret_cast<raw_state::deleter1_t>(deleter));
                }

                template <class V>
                inline void set_deleter(deleter2_t<V> deleter, V *arg)
                {
                    v.set_deleter(reinterpret_cast<raw_state::deleter2_t>(deleter), arg);
                }

            public:
                /**
                 * Cleanup all data.
                 * RT-unsafe method, thread-unsafe method. Should be called when there is no
                 * concurrent access from another threads.
                 */
                inline void clear()                     { v.clear();                            }

                /**
                 * Cleanup all data and forget about deleter function.
                 * RT-unsafe method, thread-unsafe method. Should be called when there is no
                 * concurrent access from another threads.
                 */
                inline void flush()                     { v.destroy();                          }

                /**
                 * Cleanup all garbage that can be stored in the state
                 * Thread-safe method but RT-unsafe method
                 */
                inline void gc()                        { v.gc();                               }

                /**
                 * Update state. Call deleter for garbage and previous pending state.
                 * This is thread-safe but RT-unsafe method.
                 * @param new_state new state to set
                 */
                inline void push(T *new_state)          { v.push(new_state);                    }

                /**
                 * Refresh and get current state. Call deleter for garbage and previous pending state.
                 * This is thread safe but RT-unsafe method.
                 * @return pointer to current state
                 */
                inline T *pull()                        { return tcast(v.pull());               }

                /**
                 * Update state. Do not call deleter for garbage and previous pending state.
                 * This is thread-safe and RT-safe method that should be called only in conjunction with pull().
                 * Otherwise it won't update until garbage is properly cleaned up.
                 *
                 * @param new_state new state to set
                 */
                inline bool set(T *new_state)           { return v.set(new_state);              }

                /**
                 * Refresh and get current state. Do not call deleter for garbage and previous pending state.
                 * This is thread-safe and RT-safe method that should be called only in conjunction with push().
                 * Otherwise it won't update until garbage is properly cleaned up.
                 *
                 * @return pointer to current state
                 */
                inline T *get()                         { return tcast(v.get());                }

                /**
                 * Get current state without refresh.
                 * Thread-safe and RT-safe method
                 *
                 * @return pointer to current state
                 */
                inline T *current() const               { return tcast(v.current());            }

                /**
                 * Check that there is a pending state that should be applied
                 * Thread-safe and RT-safe method
                 *
                 * @return true if there is a pending state that should be applied
                 */
                inline bool pending() const             { return v.pending();                   }

        };
    } /* namespace lltl */
} /* namespace lsp */




#endif /* LSP_PLUG_IN_LLTL_STATE_H_ */
