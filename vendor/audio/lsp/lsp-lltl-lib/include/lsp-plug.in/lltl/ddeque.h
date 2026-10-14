/*
 * Copyright (C) 2026 Linux Studio Plugins Project <https://lsp-plug.in/>
 *           (C) 2026 Vladimir Sadovnikov <sadko4u@gmail.com>
 *
 * This file is part of lsp-lltl-lib
 * Created on: 3 янв. 2026 г.
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

#ifndef LSP_PLUG_IN_LLTL_DDEQUE_H_
#define LSP_PLUG_IN_LLTL_DDEQUE_H_

#include <lsp-plug.in/lltl/version.h>

#include <lsp-plug.in/common/types.h>
#include <lsp-plug.in/lltl/iterator.h>
#include <lsp-plug.in/lltl/spec.h>

namespace lsp
{
    namespace lltl
    {
        /**
         * Raw data deque implementation with fixed set of routines
         */
        struct LSP_LLTL_LIB_PUBLIC raw_ddeque
        {
            public:
                static constexpr size_t DEFAULT_CHUNK_CAPACITY = 1024;

            public:
                typedef struct chunk_t
                {
                    chunk_t        *pPrev;
                    chunk_t        *pNext;
                    size_t          nHead;
                    size_t          nTail;
                    uint8_t         vData[];
                } chunk_t;

            public:
                chunk_t    *pHead;          // Head chunk
                chunk_t    *pTail;          // Tail chunk
                chunk_t    *pUnused;        // List of unused chunks
                size_t      nItems;         // Number of elements stored in the deque
                size_t      nChunks;        // Overall number of chunks
                size_t      nUnused;        // Number of unused chunks
                size_t      nSizeOf;        // Size of one element stored in the deque
                size_t      nChunkSize;     // Size of one chunk in elements

            private:
                chunk_t        *acquire_chunk();
                void            release_chunk(chunk_t *chunk);
                chunk_t        *acquire_chunk_list(size_t count);
                chunk_t        *alloc_chunk();
                chunk_t        *alloc_chunk_list(size_t count);
                chunk_t        *acquire_unused_chunk_list(size_t count);
                void            free_chunk_list(chunk_t *head);
                chunk_t        *preallocate_front(size_t count);
                chunk_t        *preallocate_back(size_t count);
                inline void     forward_copy(void *dst, const void *src, size_t count);
                inline void     reverse_copy(void *dst, const void *src, size_t count);

            public:
                static const iter_vtbl_t    iterator_vtbl;

            public:
                void            init(size_t n_sizeof, size_t chunk_capacity);
                void            clear();
                void            truncate();
                void            flush();

                void            swap(raw_ddeque *src);
                bool            reserve(size_t capacity);
                void           *push_back(const void *data);
                void           *push_front(const void *data);
                void           *push_back();
                void           *push_front();
                bool            push_back(const void *data, size_t count);
                bool            push_front(const void *data, size_t count);
                bool            prepend(const void *data, size_t count);
                void           *first();
                void           *last();
                void           *first(void *data);
                void           *last(void *data);
                bool            pop_back(void *data);
                bool            pop_back();
                bool            pop_front(void *data);
                bool            pop_front();
                size_t          pop_back(void *data, size_t count);
                size_t          pop_front(void *data, size_t count);
                size_t          take_back(void *data, size_t count);
                size_t          chunks_count(size_t count);
                void           *get(size_t index);
                ssize_t         index_of(const void *ptr);

                raw_iterator    iter();
                raw_iterator    riter();

            public:
                static void     iter_move(raw_iterator *i, ssize_t n);
                static void    *iter_get(raw_iterator *i);
                static ssize_t  iter_compare(const raw_iterator *a, const raw_iterator *b);
                static size_t   iter_count(const raw_iterator *i);
        };

        /**
         * Data deque template
         */
        template <class T>
        class ddeque
        {
            private:
                mutable raw_ddeque  v;

                inline static T *cast(void *ptr)                                { return static_cast<T *>(ptr);         }
                inline static const T *ccast(const void *ptr)                   { return static_cast<const T *>(ptr);   }

            public:
                typedef ssize_t (* cmp_func_t)(const T *a, const T *b);

            public:
                explicit inline ddeque(size_t chunk_capacity = raw_ddeque::DEFAULT_CHUNK_CAPACITY)
                {
                    v.init(sizeof(T), chunk_capacity);
                }

                ddeque(const ddeque<T> & src) = delete;
                ddeque(ddeque<T> && src) = delete;
                ~ddeque() { v.flush(); };

                ddeque<T> & operator = (const ddeque<T> & src) = delete;
                ddeque<T> & operator = (ddeque<T> & src) = delete;

            public:
                // Size and capacity
                inline size_t size() const                                      { return v.nItems;                  }
                inline size_t capacity() const                                  { return v.nChunks * v.nChunkSize;  }
                inline size_t chunks() const                                    { return v.nChunks;                 }
                inline size_t used_chunks() const                               { return v.nChunks - v.nUnused;     }
                inline size_t unused_chunks() const                             { return v.nUnused;                 }
                inline size_t extra_chunks() const                              { return v.nUnused;                 }
                inline bool is_empty() const                                    { return v.nItems <= 0;             }

            public:
                // Whole collection manipulations
                inline void clear()                                             { v.clear();                        }
                inline void flush()                                             { v.flush();                        }
                inline void truncate()                                          { v.truncate();                     }
                inline bool reserve(size_t capacity)                            { return v.reserve(capacity);       }

            public:
                // Signle element manipulations (no argument)
                T *push_back()                                                  { return cast(v.push_back());       }
                T *push_front()                                                 { return cast(v.push_front());      }
                T *append()                                                     { return cast(v.push_back());       }
                T *prepend()                                                    { return cast(v.push_front());      }
                bool pop_back()                                                 { return v.pop_back();              }
                bool pop_front()                                                { return v.pop_front();             }

                T *get(size_t index)                                            { return cast(v.get(index));        }
                const T *get(size_t index) const                                { return ccast(v.get(index));       }
                ssize_t index_of(const T * item) const                          { return v.index_of(item);          }
                inline bool contains(const T *p) const                          { return v.index_of(p) >= 0;        }

            public:
                // Single element manipulations (pointer argument)
                T *push_back(const T *item)                                     { return cast(v.push_back(item));   }
                T *push_front(const T *item)                                    { return cast(v.push_front(item));  }
                T *append(const T *item)                                        { return cast(v.push_back(item));   }
                T *prepend(const T *item)                                       { return cast(v.push_front(item));  }

                bool pop_back(T *item)                                          { return v.pop_back(item);          }
                bool pop_front(T *item)                                         { return v.pop_front(item);         }
                bool pop_last(T *item)                                          { return v.pop_back(item);          }
                bool pop_first(T *item)                                         { return v.pop_front(item);         }

                // Return pointer to stored element
                T * front()                                                     { return cast(v.first());           }
                T * back()                                                      { return cast(v.last());            }
                T * first()                                                     { return cast(v.first());           }
                T * last()                                                      { return cast(v.last());            }
                const T * front() const                                         { return ccast(v.first());          }
                const T * back() const                                          { return ccast(v.last());           }
                const T * first() const                                         { return ccast(v.first());          }
                const T * last() const                                          { return ccast(v.last());           }

                // Try to read element into passed pointer
                T * front(T * item)                                             { return cast(v.first(item));       }
                T * back(T * item)                                              { return cast(v.last(item));        }
                T * first(T * item)                                             { return cast(v.first(item));       }
                T * last(T * item)                                              { return cast(v.last(item));        }
                const T * front(T * item) const                                 { return ccast(v.first(item));      }
                const T * back(T * item) const                                  { return ccast(v.last(item));       }
                const T * first(T * item) const                                 { return ccast(v.first(item));      }
                const T * last(T * item) const                                  { return ccast(v.last(item));       }

            public:
                // Single element manipulations (reference argument)
                T *push_back(const T & item)                                    { return cast(v.push_back(&item));  }
                T *push_front(const T & item)                                   { return cast(v.push_front(&item)); }
                T *append(const T & item)                                       { return cast(v.push_back(&item));  }
                T *prepend(const T & item)                                      { return cast(v.push_front(&item)); }

                bool pop_back(T & item)                                         { return v.pop_back(&item);         }
                bool pop_front(T & item)                                        { return v.pop_front(&item);        }
                bool pop_last(T & item)                                         { return v.pop_back(&item);         }
                bool pop_first(T & item)                                        { return v.pop_front(&item);        }

                // Try to read element into passed reference
                T * front(T & item)                                             { return cast(v.first(&item));      }
                T * back(T & item)                                              { return cast(v.last(&item));       }
                T * first(T & item)                                             { return cast(v.first(&item));      }
                T * last(T & item)                                              { return cast(v.last(&item));       }
                const T * front(T & item) const                                 { return ccast(v.first(&item));     }
                const T * back(T & item) const                                  { return ccast(v.last(&item));      }
                const T * first(T & item) const                                 { return ccast(v.first(&item));     }
                const T * last(T & item) const                                  { return ccast(v.last(&item));      }

            public:
                // Bulk element manipulations
                /**
                 * Put the elements to the end of the queue. Keep the same order of elements for sequential pop_front() calls.
                 * @param data pointer to elements to store
                 * @param count number of elements
                 * @return true if elements have been placed
                 */
                bool push_back(const T * data, size_t count)                    { return v.push_back(data, count);  }

                /**
                 * Put the elements to the end of the queue. Keep the same order of elements for sequential pop_front() calls.
                 * @param data pointer to elements to store
                 * @param count number of elements
                 * @return true if elements have been placed
                 */
                bool put_back(const T * data, size_t count)                     { return v.push_back(data, count);  }

                /**
                 * Put the elements to the end of the queue. Keep the same order of elements for sequential pop_back() calls.
                 * @param data pointer to elements to store
                 * @param count number of elements
                 * @return true if elements have been placed
                 */
                bool push_front(const T * data, size_t count)                   { return v.push_front(data, count); }

                /**
                 * Put the elements to the end of the queue. Make the reverse order of elements for sequential pop_back() calls.
                 * @param data pointer to elements to store
                 * @param count number of elements
                 * @return true if elements have been placed
                 */
                bool put_front(const T * data, size_t count)                    { return v.prepend(data, count);    }

                /**
                 * Extract elements from the end of the queue. Keep the same order of elements for sequential push_front() calls.
                 * @param data pointer to store elements
                 * @param count number of elements to extract
                 * @return actual number of elements extracted
                 */
                size_t pop_back(T * data, size_t count)                         { return v.pop_back(data, count);   }

                /**
                 * Extract elements from the end of the queue. Make the reverse order of elements for sequential push_front() calls.
                 * @param data pointer to store elements
                 * @param count number of elements to extract
                 * @return actual number of elements extracted
                 */
                size_t take_back(T * data, size_t count)                        { return v.take_back(data, count);  }

                /**
                 * Extract elements from beginning of the queue. Keep the same order of elements for sequential push_back() calls.
                 * @param data pointer to store elements
                 * @param count number of elements to extract
                 * @return actual number of elements extracted
                 */
                size_t pop_front(T * data, size_t count)                        { return v.pop_front(data, count);  }

                /**
                 * Extract elements from beginning of the queue. Keep the same order of elements for sequential push_back() calls.
                 * @param data pointer to store elements
                 * @param count number of elements to extract
                 * @return actual number of elements extracted
                 */
                size_t take_front(T * data, size_t count)                       { return v.pop_front(data, count);  }


            public:
                // Operators
                inline T *operator[](size_t idx)                                { return get(idx);                  }
                inline const T *operator[](size_t idx) const                    { return get(idx);                  }

            public:
                // Iterators
                inline iterator<T> values()                                     { return iterator<T>(v.iter());         }
                inline iterator<T> rvalues()                                    { return iterator<T>(v.riter());        }
                inline iterator<const T> values() const                         { return iterator<const T>(v.iter());   }
                inline iterator<const T> rvalues() const                        { return iterator<const T>(v.riter());  }
        };
    } /* namespace lltl */
} /* namespace lsp */




#endif /* LSP_PLUG_IN_LLTL_DDEQUE_H_ */
