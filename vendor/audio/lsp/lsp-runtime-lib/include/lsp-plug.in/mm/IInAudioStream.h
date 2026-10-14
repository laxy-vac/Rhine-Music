/*
 * Copyright (C) 2025 Linux Studio Plugins Project <https://lsp-plug.in/>
 *           (C) 2025 Vladimir Sadovnikov <sadko4u@gmail.com>
 *
 * This file is part of lsp-runtime-lib
 * Created on: 16 апр. 2020 г.
 *
 * lsp-runtime-lib is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Lesser General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * any later version.
 *
 * lsp-runtime-lib is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU Lesser General Public License for more details.
 *
 * You should have received a copy of the GNU Lesser General Public License
 * along with lsp-runtime-lib. If not, see <https://www.gnu.org/licenses/>.
 */

#ifndef LSP_PLUG_IN_MM_IINAUDIOSTREAM_H_
#define LSP_PLUG_IN_MM_IINAUDIOSTREAM_H_

#include <lsp-plug.in/runtime/version.h>

#include <lsp-plug.in/common/status.h>
#include <lsp-plug.in/mm/types.h>

namespace lsp
{
    namespace mm
    {
        /**
         * Interface for input audio stream
         */
        class IInAudioStream
        {
            public:
                static const size_t IO_BUF_SIZE         = 0x1000;

            protected:
                wssize_t            nOffset;            // Offset from beginning, negative if closed
                status_t            nErrorCode;         // Last error code
                uint8_t            *pBuffer;            // Buffer for sample format conversion
                size_t              nBufSize;           // Size of buffer
                void               *pUserData;          // User data
                user_data_deleter_t pDeleter;           // User data deleter

            protected:
                void                do_close();

                inline status_t     set_error(status_t error)   { return nErrorCode = error; }

                /**
                 * Ensure that internal buffer has enough capacity to keep specified number of bytes
                 * @param bytes number of bytes
                 * @return status of operation
                 */
                bool                ensure_capacity(size_t bytes);

                /**
                 * Perform direct read of sample data into the buffer
                 *
                 * @param dst buffer to store samples
                 * @param nframes number of frames to read
                 * @param fmt sample format selected for read
                 * @return number of frames actually read or negative error code
                 */
                virtual ssize_t     direct_read(void *dst, size_t nframes, size_t fmt);

                /**
                 * Select actual sample format for direct read
                 * @param fmt the requested
                 * @return actual sample format, by defaul 0 (not supported)
                 */
                virtual size_t      select_format(size_t fmt);

                /**
                 * Perform read with conversion
                 * @param dst destination buffer to perform read
                 * @param nframes number of frames to read
                 * @param fmt the requested sample format
                 * @return number of frames to read or negative error code
                 */
                virtual ssize_t     conv_read(void *dst, size_t nframes, size_t fmt);

            public:
                explicit IInAudioStream();
                IInAudioStream(const IInAudioStream &) = delete;
                IInAudioStream(IInAudioStream &&) = delete;
                virtual ~IInAudioStream();

                IInAudioStream & operator = (const IInAudioStream &) = delete;
                IInAudioStream & operator = (IInAudioStream &&) = delete;

            public:
                /**
                 * Check whether audio stream is closed
                 * @return true if audio stream is closed
                 */
                inline bool         is_closed() const           { return nOffset < 0; }

                /** Get last I/O error code
                 *
                 * @return last I/O error code
                 */
                inline status_t     last_error() const          { return nErrorCode; };

                /**
                 * Obtain the information about audio stream
                 * @param dst destination to store the audio stream information
                 * @return status of operation
                 */
                virtual status_t    info(audio_stream_t *dst) const;

                /**
                 * Get sample rate
                 * @return sample rate
                 */
                virtual size_t      sample_rate() const;

                /**
                 * Get number of channels
                 * @return number of channels
                 */
                virtual size_t      channels() const;

                /**
                 * Get overall duration
                 * @return overall number of frames available in audio stream,
                 * negative if number of frames can not be estimated
                 */
                virtual wssize_t    length() const;

                /**
                 * Get sample format
                 * @return sample format
                 */
                virtual size_t      format() const;

                /**
                 * Close audio stream
                 * @return status of operations
                 */
                virtual status_t    close();

                /**
                 * Skip amount of frames
                 * @param nframes number of frames to skip
                 * @return number of frames skipped or negative status code
                 */
                virtual wssize_t    skip(wsize_t nframes);

                /**
                 * Get actual position in frames from beginning of the stream
                 * @return number of frames from beginning of the stream or negative error code
                 */
                virtual wssize_t    position();

                /**
                 * Try to seek stream at the specified position
                 * @param offset the offset from the beginning of the stream
                 * @return actual position in frames from beginnig of the stream
                 *   or negative error code on error (STATUS_NOT_SUPPORTED if stream
                 *   positioning is not supported)
                 */
                virtual wssize_t    seek(wsize_t offset);

                /**
                 * Different reads
                 * @param dst destination buffer to perform read
                 * @param nframes number of frames to read
                 * @return number of frames actually read or negative status fo operation
                 */
                virtual ssize_t     read(uint8_t *dst, size_t nframes);
                virtual ssize_t     read(int8_t *dst, size_t nframes);
                virtual ssize_t     read(uint16_t *dst, size_t nframes);
                virtual ssize_t     read(int16_t *dst, size_t nframes);
                virtual ssize_t     read(uint32_t *dst, size_t nframes);
                virtual ssize_t     read(int32_t *dst, size_t nframes);
                virtual ssize_t     read(f32_t *dst, size_t nframes);
                virtual ssize_t     read(f64_t *dst, size_t nframes);

                /**
                 * Strict type reads
                 * @param dst destination buffer to perform read
                 * @param nframes number of frames to read
                 */
                inline ssize_t      read_u8(void *dst, size_t nframes)      { return read(static_cast<uint8_t *>(dst), nframes);    }
                inline ssize_t      read_s8(void *dst, size_t nframes)      { return read(static_cast<int8_t *>(dst), nframes);     }
                inline ssize_t      read_u16(void *dst, size_t nframes)     { return read(static_cast<uint16_t *>(dst), nframes);   }
                inline ssize_t      read_s16(void *dst, size_t nframes)     { return read(static_cast<int16_t *>(dst), nframes);    }
                inline ssize_t      read_u32(void *dst, size_t nframes)     { return read(static_cast<uint32_t *>(dst), nframes);   }
                inline ssize_t      read_s32(void *dst, size_t nframes)     { return read(static_cast<int32_t *>(dst), nframes);    }
                inline ssize_t      read_f32(void *dst, size_t nframes)     { return read(static_cast<f32_t *>(dst), nframes);      }
                inline ssize_t      read_f64(void *dst, size_t nframes)     { return read(static_cast<f64_t *>(dst), nframes);      }

            public:
                /**
                 * Set user data. If previous user data has been set, it will be removed
                 * if the deleter was provided
                 * @param data data to set
                 * @param deleter deleter to remove the data
                 */
                void                set_user_data(void *data, user_data_deleter_t deleter = NULL);

                /** Get user data
                 * @return user data currently bound to the object
                 */
                inline void        *user_data()                 { return pUserData;     }
        };
    
    } /* namespace mm */
} /* namespace lsp */

#endif /* LSP_PLUG_IN_MM_IINAUDIOSTREAM_H_ */
