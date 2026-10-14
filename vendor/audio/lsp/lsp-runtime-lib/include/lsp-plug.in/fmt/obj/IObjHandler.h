/*
 * Copyright (C) 2025 Linux Studio Plugins Project <https://lsp-plug.in/>
 *           (C) 2025 Vladimir Sadovnikov <sadko4u@gmail.com>
 *
 * This file is part of lsp-runtime-lib
 * Created on: 21 апр. 2017 г.
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

#ifndef LSP_PLUG_IN_FMT_OBJ_IOBJHANDLER_H_
#define LSP_PLUG_IN_FMT_OBJ_IOBJHANDLER_H_

#include <lsp-plug.in/runtime/version.h>
#include <lsp-plug.in/runtime/LSPString.h>
#include <lsp-plug.in/common/types.h>
#include <lsp-plug.in/common/status.h>

#include <lsp-plug.in/fmt/obj/const.h>

namespace lsp
{
    namespace obj
    {
        /** File contents handler interface
         *
         */
        class IObjHandler
        {
            public:
                virtual ~IObjHandler();

            public:
                /** Start object
                 *
                 * @param name object name
                 * @return status of operation
                 */
                virtual status_t begin_object(const char *name);

                /** Start object
                 *
                 * @param name object name
                 * @return status of operation
                 */
                virtual status_t begin_object(const LSPString *name);

                /** End object
                 *
                 * @return status of operation
                 */
                virtual status_t end_object();

                /**
                 * This callback is called when there is no more data at the input
                 * and allows to post-process/finalize loaded data structures
                 * @return status of operation
                 */
                virtual status_t end_of_data();

                /** Add vertex
                 *
                 * @param x vertex X coordinate
                 * @param y vertex Y coordinate
                 * @param z vertex Z coordinate
                 * @param w vertex W coordinate
                 * @return number of added vertex or negative error code
                 */
                virtual ssize_t add_vertex(float x, float y, float z, float w);

                /** Add parameter vertex
                 *
                 * @param x vertex X coordinate
                 * @param y vertex Y coordinate
                 * @param z vertex Z coordinate
                 * @param w vertex W coordinate
                 * @return number of added vertex or negative error code
                 */
                virtual ssize_t add_param_vertex(float x, float y, float z, float w);

                /** Add normal
                 *
                 * @param nx normal x
                 * @param ny normal y
                 * @param nz normal z
                 * @param nw normal w
                 * @return number of added normal or negative error code
                 */
                virtual ssize_t add_normal(float nx, float ny, float nz, float nw);

                /** Add texture vertex
                 *
                 * @param u texture U coordinate
                 * @param v texture V coordinate
                 * @param w texture W coordinate
                 * @return number of added texture vertex or negative error code
                 */
                virtual ssize_t add_texture_vertex(float u, float v, float w);

                /** Add face
                 *
                 * @param vv array of vertex indexes starting with 0 (negative value if not present)
                 * @param vn array of normal indexes starting with 0 (negative value if not present)
                 * @param vt array of texture vertex indexes starting with 0 (negative value if not present)
                 * @param n number of elements in vv, vn and vt
                 * @return number of added face or negative error code
                 */
                virtual ssize_t add_face(const index_t *vv, const index_t *vn, const index_t *vt, size_t n);

                /** Add points
                 *
                 * @param vv array of vertex indexes starting with 1 (0 if not present)
                 * @param n number of elements in vv
                 * @return number of added points object or negative error code
                 */
                virtual ssize_t add_points(const index_t *vv, size_t n);

                /** Add line
                 *
                 * @param vv array of vertex indexes starting with 0 (negative value if not present)
                 * @param vt array of texture vertex indexes starting with 0 (negative value if not present)
                 * @param n number of elements in vv
                 * @return number of added line or negative error code
                 */
                virtual ssize_t add_line(const index_t *vv, const index_t *vt, size_t n);
        };
    
    } /* namespace obj */
} /* namespace lsp */

#endif /* LSP_PLUG_IN_FMT_OBJ_IOBJHANDLER_H_ */
